package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	conv "github.com/Cor-Incorporated/Grift/services/control-api/internal/conversation"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/llmclient"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/prompt"
	"github.com/google/uuid"
)

const defaultConversationSystemPrompt = "You are a helpful intake assistant. Ask concise follow-up questions and summarize clearly."

// LLMClient is the control-api contract for llm-gateway.
type LLMClient interface {
	Complete(ctx context.Context, messages []llmclient.Message, opts llmclient.CompletionOptions) (*llmclient.CompletionResponse, error)
}

// ConversationHandler handles conversation turn APIs.
type ConversationHandler struct {
	db        *sql.DB
	publisher *conv.Publisher
	llmClient LLMClient
}

// NewConversationHandler constructs a ConversationHandler.
func NewConversationHandler(db *sql.DB, publisher *conv.Publisher, llmClient LLMClient) *ConversationHandler {
	return &ConversationHandler{
		db:        db,
		publisher: publisher,
		llmClient: llmClient,
	}
}

// RegisterConversationRoutes registers conversation endpoints.
func RegisterConversationRoutes(mux *http.ServeMux, h *ConversationHandler) {
	mux.HandleFunc("GET /v1/cases/{caseId}/conversations", h.ListConversations)
	mux.HandleFunc("POST /v1/cases/{caseId}/conversations", h.SendMessage)
	mux.HandleFunc("POST /v1/cases/{caseId}/conversations/stream", h.StreamConversation)
}

// ListConversations handles GET /v1/cases/{caseId}/conversations.
func (h *ConversationHandler) ListConversations(w http.ResponseWriter, r *http.Request) {
	tenantID, caseID, ok := h.resolveContext(w, r)
	if !ok {
		return
	}
	limit, offset := parsePagination(r)
	turns, total, err := listConversationTurns(r.Context(), h.db, tenantID, caseID, limit, offset)
	if err != nil {
		writeJSONError(w, "failed to list conversations", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": turns, "total": total})
}

// SendMessage handles POST /v1/cases/{caseId}/conversations.
func (h *ConversationHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	assistantTurn, err := h.handleMessage(w, r, false)
	if err != nil {
		writeJSONError(w, err.Error(), httpStatusForError(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": assistantTurn})
}

// StreamConversation handles POST /v1/cases/{caseId}/conversations/stream.
func (h *ConversationHandler) StreamConversation(w http.ResponseWriter, r *http.Request) {
	if _, err := h.handleMessage(w, r, true); err != nil {
		writeStreamError(w, err)
	}
}

func (h *ConversationHandler) handleMessage(w http.ResponseWriter, r *http.Request, stream bool) (*conversationTurnResponse, error) {
	if h.db == nil {
		return nil, errWithStatus("database not configured", http.StatusServiceUnavailable)
	}
	if h.llmClient == nil {
		return nil, errWithStatus("llm client not configured", http.StatusServiceUnavailable)
	}

	tenantID, caseID, ok := h.resolveContext(w, r)
	if !ok {
		return nil, errWithStatus("invalid request context", http.StatusBadRequest)
	}

	var req sendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return nil, errWithStatus("invalid JSON body", http.StatusBadRequest)
	}
	if strings.TrimSpace(req.Content) == "" {
		return nil, errWithStatus("content is required", http.StatusBadRequest)
	}

	if err := ensureCaseExists(r.Context(), h.db, tenantID, caseID); err != nil {
		if err == sql.ErrNoRows {
			return nil, errWithStatus("case not found", http.StatusNotFound)
		}
		return nil, errWithStatus("failed to resolve case", http.StatusInternalServerError)
	}

	if _, err := insertConversationTurn(r.Context(), h.db, tenantID, caseID, "user", req.Content, map[string]any{"message_type": "user_input"}); err != nil {
		return nil, errWithStatus("failed to save user turn", http.StatusInternalServerError)
	}

	history, _, err := listConversationTurns(r.Context(), h.db, tenantID, caseID, 10, 0)
	if err != nil {
		return nil, errWithStatus("failed to load conversation history", http.StatusInternalServerError)
	}

	messages := buildConversationMessages(history)
	opts := llmclient.CompletionOptions{
		Model:              "stub",
		Stream:             stream,
		DataClassification: r.Header.Get("X-Data-Classification"),
	}
	if stream {
		w.Header().Set("Content-Type", "application/x-ndjson")
		flusher, ok := w.(http.Flusher)
		if !ok {
			return nil, errWithStatus("streaming not supported", http.StatusInternalServerError)
		}
		opts.OnChunk = func(chunk llmclient.Chunk) error {
			if err := json.NewEncoder(w).Encode(chunk); err != nil {
				return err
			}
			flusher.Flush()
			return nil
		}
	}

	completion, err := h.llmClient.Complete(r.Context(), messages, opts)
	if err != nil {
		return nil, errWithStatus("llm request failed", http.StatusBadGateway)
	}

	assistantTurn, err := insertConversationTurn(r.Context(), h.db, tenantID, caseID, "assistant", completion.Content, map[string]any{
		"system_prompt_version": "v1",
		"model_used":            completion.Model,
		"fallback_used":         completion.FallbackUsed,
		"data_classification":   completion.DataClassification,
	})
	if err != nil {
		return nil, errWithStatus("failed to save assistant turn", http.StatusInternalServerError)
	}

	if err := h.publishTurnCompleted(r.Context(), tenantID, caseID, assistantTurn, history); err != nil {
		return nil, errWithStatus("failed to publish turn event", http.StatusInternalServerError)
	}

	return assistantTurn, nil
}

func (h *ConversationHandler) resolveContext(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	if h.db == nil {
		writeJSONError(w, "database not configured", http.StatusServiceUnavailable)
		return uuid.Nil, uuid.Nil, false
	}
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, caseID, true
}

func (h *ConversationHandler) publishTurnCompleted(ctx context.Context, tenantID uuid.UUID, caseID uuid.UUID, assistantTurn *conversationTurnResponse, history []conversationTurnResponse) error {
	if h.publisher == nil {
		return nil
	}

	previousTurns := make([]conv.Turn, 0, len(history))
	for _, turn := range history {
		previousTurns = append(previousTurns, conv.Turn{
			Role:       turn.Role,
			Content:    turn.Content,
			TurnNumber: turn.TurnNumber,
		})
	}

	return h.publisher.PublishTurnCompleted(ctx, conv.PublishInput{
		TenantID:            tenantID,
		SessionID:           caseID,
		TurnNumber:          assistantTurn.TurnNumber,
		Role:                assistantTurn.Role,
		Content:             assistantTurn.Content,
		PreviousTurns:       previousTurns,
		SystemPromptVersion: metadataString(assistantTurn.Metadata, "system_prompt_version"),
		ModelUsed:           metadataString(assistantTurn.Metadata, "model_used"),
		FallbackUsed:        metadataBool(assistantTurn.Metadata, "fallback_used"),
		SourceDomain:        "estimation",
	})
}

func listConversationTurns(ctx context.Context, db *sql.DB, tenantID uuid.UUID, caseID uuid.UUID, limit int, offset int) ([]conversationTurnResponse, int, error) {
	exec := dbExecutorFromContext(ctx, db)

	var total int
	if err := exec.QueryRowContext(ctx, `SELECT COUNT(*) FROM conversation_turns WHERE tenant_id = $1 AND case_id = $2`, tenantID, caseID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count conversation turns: %w", err)
	}

	rows, err := exec.QueryContext(
		ctx,
		`WITH ordered AS (
			SELECT id, case_id, role, content, metadata, created_at,
				ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS turn_number
			FROM conversation_turns
			WHERE tenant_id = $1 AND case_id = $2
		)
		SELECT id, case_id, role, content, metadata, created_at, turn_number
		FROM ordered
		ORDER BY turn_number ASC
		LIMIT $3 OFFSET $4`,
		tenantID,
		caseID,
		limit,
		offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list conversation turns: %w", err)
	}
	defer rows.Close()

	var turns []conversationTurnResponse
	for rows.Next() {
		turn, err := scanConversationTurn(rows)
		if err != nil {
			return nil, 0, err
		}
		turns = append(turns, *turn)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate conversation turns: %w", err)
	}
	return turns, total, nil
}

func insertConversationTurn(ctx context.Context, db *sql.DB, tenantID uuid.UUID, caseID uuid.UUID, role string, content string, metadata map[string]any) (*conversationTurnResponse, error) {
	payload, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("marshal turn metadata: %w", err)
	}

	turn := &conversationTurnResponse{
		ID:       uuid.New(),
		CaseID:   caseID,
		Role:     role,
		Content:  content,
		Metadata: metadata,
	}
	row := dbExecutorFromContext(ctx, db).QueryRowContext(
		ctx,
		`INSERT INTO conversation_turns (id, tenant_id, case_id, role, content, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING created_at`,
		turn.ID,
		tenantID,
		turn.CaseID,
		turn.Role,
		turn.Content,
		payload,
	)
	if err := row.Scan(&turn.CreatedAt); err != nil {
		return nil, fmt.Errorf("insert conversation turn: %w", err)
	}

	if err := dbExecutorFromContext(ctx, db).QueryRowContext(
		ctx,
		`WITH ordered AS (
			SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS turn_number
			FROM conversation_turns
			WHERE tenant_id = $1 AND case_id = $2
		)
		SELECT turn_number FROM ordered WHERE id = $3`,
		tenantID,
		caseID,
		turn.ID,
	).Scan(&turn.TurnNumber); err != nil {
		return nil, fmt.Errorf("count conversation turns: %w", err)
	}

	return turn, nil
}

func ensureCaseExists(ctx context.Context, db *sql.DB, tenantID uuid.UUID, caseID uuid.UUID) error {
	var id uuid.UUID
	if err := dbExecutorFromContext(ctx, db).QueryRowContext(ctx, `SELECT id FROM cases WHERE tenant_id = $1 AND id = $2`, tenantID, caseID).Scan(&id); err != nil {
		return err
	}
	return nil
}

func buildConversationMessages(history []conversationTurnResponse) []llmclient.Message {
	systemPrompt := prompt.InjectCompletenessFeedback(defaultConversationSystemPrompt, extractMissingItems(history))
	messages := []llmclient.Message{{Role: "system", Content: systemPrompt}}
	for _, turn := range history {
		messages = append(messages, llmclient.Message{
			Role:    turn.Role,
			Content: turn.Content,
		})
	}
	return messages
}

func extractMissingItems(history []conversationTurnResponse) []string {
	for i := len(history) - 1; i >= 0; i-- {
		items, ok := history[i].Metadata["missing_items"].([]any)
		if !ok || len(items) == 0 {
			continue
		}

		result := make([]string, 0, len(items))
		for _, item := range items {
			if value, ok := item.(string); ok && value != "" {
				result = append(result, value)
			}
		}
		if len(result) > 0 {
			return result
		}
	}
	return nil
}

func scanConversationTurn(scanner rowScanner) (*conversationTurnResponse, error) {
	var (
		turn        conversationTurnResponse
		metadataRaw []byte
	)
	if err := scanner.Scan(
		&turn.ID,
		&turn.CaseID,
		&turn.Role,
		&turn.Content,
		&metadataRaw,
		&turn.CreatedAt,
		&turn.TurnNumber,
	); err != nil {
		return nil, fmt.Errorf("scan conversation turn: %w", err)
	}
	turn.Metadata = map[string]any{}
	if len(metadataRaw) > 0 {
		if err := json.Unmarshal(metadataRaw, &turn.Metadata); err != nil {
			return nil, fmt.Errorf("decode conversation metadata: %w", err)
		}
	}
	return &turn, nil
}

type conversationTurnResponse struct {
	ID         uuid.UUID      `json:"id"`
	CaseID     uuid.UUID      `json:"case_id"`
	Role       string         `json:"role"`
	Content    string         `json:"content"`
	Metadata   map[string]any `json:"metadata"`
	CreatedAt  time.Time      `json:"created_at"`
	TurnNumber int            `json:"-"`
}

type sendMessageRequest struct {
	Content string `json:"content"`
}

func metadataString(metadata map[string]any, key string) string {
	if value, ok := metadata[key].(string); ok {
		return value
	}
	return ""
}

func metadataBool(metadata map[string]any, key string) bool {
	if value, ok := metadata[key].(bool); ok {
		return value
	}
	return false
}

type statusError struct {
	status int
	msg    string
}

func (e statusError) Error() string {
	return e.msg
}

func errWithStatus(msg string, status int) error {
	return statusError{status: status, msg: msg}
}

func httpStatusForError(err error) int {
	if typed, ok := err.(statusError); ok {
		return typed.status
	}
	return http.StatusInternalServerError
}

func writeStreamError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":  "error",
		"error": err.Error(),
	})
}
