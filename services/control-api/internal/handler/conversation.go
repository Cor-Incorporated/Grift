package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/llmclient"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

// ConversationHandler handles conversation turn APIs.
type ConversationHandler struct {
	svc *service.ConversationService
}

// NewConversationHandler constructs a ConversationHandler.
func NewConversationHandler(svc *service.ConversationService) *ConversationHandler {
	return &ConversationHandler{svc: svc}
}

// RegisterConversationRoutes registers conversation endpoints.
func RegisterConversationRoutes(mux *http.ServeMux, h *ConversationHandler) {
	mux.HandleFunc("GET /v1/cases/{caseId}/conversations", h.ListConversations)
	mux.HandleFunc("POST /v1/cases/{caseId}/conversations", h.SendMessage)
	mux.HandleFunc("POST /v1/cases/{caseId}/conversations/stream", h.StreamConversation)
}

// ListConversations handles GET /v1/cases/{caseId}/conversations.
func (h *ConversationHandler) ListConversations(w http.ResponseWriter, r *http.Request) {
	tenantID, caseID, ok := resolveConversationContext(w, r)
	if !ok {
		return
	}
	limit, offset := parsePagination(r)
	turns, total, err := h.svc.ListTurns(r.Context(), tenantID, caseID, limit, offset)
	if err != nil {
		writeJSONError(w, "failed to list conversations", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": turns, "total": total})
}

// SendMessage handles POST /v1/cases/{caseId}/conversations.
func (h *ConversationHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	tenantID, caseID, ok := resolveConversationContext(w, r)
	if !ok {
		return
	}
	content, ok := parseMessageBody(w, r)
	if !ok {
		return
	}

	result, err := h.svc.SendMessage(r.Context(), service.SendMessageInput{
		TenantID:           tenantID,
		CaseID:             caseID,
		Content:            content,
		DataClassification: r.Header.Get("X-Data-Classification"),
	})
	if err != nil {
		writeJSONError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result.AssistantTurn})
}

// StreamConversation handles POST /v1/cases/{caseId}/conversations/stream.
func (h *ConversationHandler) StreamConversation(w http.ResponseWriter, r *http.Request) {
	tenantID, caseID, ok := resolveConversationContext(w, r)
	if !ok {
		return
	}
	content, ok := parseMessageBody(w, r)
	if !ok {
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeStreamError(w, errWithStatus("streaming not supported", http.StatusInternalServerError))
		return
	}

	onChunk := func(chunk llmclient.Chunk) error {
		if err := json.NewEncoder(w).Encode(chunk); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	_, err := h.svc.SendMessage(r.Context(), service.SendMessageInput{
		TenantID:           tenantID,
		CaseID:             caseID,
		Content:            content,
		DataClassification: r.Header.Get("X-Data-Classification"),
		Stream:             true,
		OnChunk:            onChunk,
	})
	if err != nil {
		writeStreamError(w, err)
	}
}

func resolveConversationContext(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
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

func parseMessageBody(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req sendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return "", false
	}
	if strings.TrimSpace(req.Content) == "" {
		writeJSONError(w, "content is required", http.StatusBadRequest)
		return "", false
	}
	return req.Content, true
}

type sendMessageRequest struct {
	Content string `json:"content"`
}
