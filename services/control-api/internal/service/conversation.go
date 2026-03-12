package service

import (
	"context"
	"database/sql"
	"fmt"

	conv "github.com/Cor-Incorporated/Grift/services/control-api/internal/conversation"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/llmclient"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/prompt"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

const defaultConversationSystemPrompt = "You are a helpful intake assistant. Ask concise follow-up questions and summarize clearly."

// LLMClient is the contract for the LLM gateway.
type LLMClient interface {
	Complete(ctx context.Context, messages []llmclient.Message, opts llmclient.CompletionOptions) (*llmclient.CompletionResponse, error)
}

// SendMessageInput contains the parameters for sending a conversation message.
type SendMessageInput struct {
	TenantID           uuid.UUID
	CaseID             uuid.UUID
	Content            string
	DataClassification string
	Stream             bool
	OnChunk            func(llmclient.Chunk) error
}

// SendMessageResult contains the result of a sent message.
type SendMessageResult struct {
	AssistantTurn *store.ConversationTurn
	Completion    *llmclient.CompletionResponse
}

// ConversationService orchestrates conversation business logic.
type ConversationService struct {
	store     store.ConversationStore
	publisher *conv.Publisher
	llmClient LLMClient
}

// NewConversationService constructs a ConversationService.
func NewConversationService(s store.ConversationStore, publisher *conv.Publisher, llmClient LLMClient) *ConversationService {
	return &ConversationService{
		store:     s,
		publisher: publisher,
		llmClient: llmClient,
	}
}

// ListTurns returns conversation turns for a case with pagination.
func (s *ConversationService) ListTurns(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]store.ConversationTurn, int, error) {
	return s.store.ListTurns(ctx, tenantID, caseID, limit, offset)
}

// SendMessage orchestrates the full message flow: validate case, insert user
// turn, build LLM messages, call LLM, insert assistant turn, publish event.
func (s *ConversationService) SendMessage(ctx context.Context, input SendMessageInput) (*SendMessageResult, error) {
	if err := s.store.EnsureCaseExists(ctx, input.TenantID, input.CaseID); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("case not found: %w", err)
		}
		return nil, fmt.Errorf("failed to resolve case: %w", err)
	}

	_, err := s.store.InsertTurn(ctx, input.TenantID, input.CaseID, "user", input.Content, map[string]any{
		"message_type": "user_input",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to save user turn: %w", err)
	}

	history, _, err := s.store.ListTurns(ctx, input.TenantID, input.CaseID, 10, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to load conversation history: %w", err)
	}

	messages := buildConversationMessages(history)
	opts := llmclient.CompletionOptions{
		Model:              "stub",
		Stream:             input.Stream,
		DataClassification: input.DataClassification,
		OnChunk:            input.OnChunk,
	}

	completion, err := s.llmClient.Complete(ctx, messages, opts)
	if err != nil {
		return nil, fmt.Errorf("llm request failed: %w", err)
	}

	assistantTurn, err := s.store.InsertTurn(ctx, input.TenantID, input.CaseID, "assistant", completion.Content, map[string]any{
		"system_prompt_version": "v1",
		"model_used":            completion.Model,
		"fallback_used":         completion.FallbackUsed,
		"data_classification":   completion.DataClassification,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to save assistant turn: %w", err)
	}

	if err := s.publishTurnCompleted(ctx, input.TenantID, input.CaseID, assistantTurn, history); err != nil {
		return nil, fmt.Errorf("failed to publish turn event: %w", err)
	}

	return &SendMessageResult{
		AssistantTurn: assistantTurn,
		Completion:    completion,
	}, nil
}

func (s *ConversationService) publishTurnCompleted(ctx context.Context, tenantID, caseID uuid.UUID, assistantTurn *store.ConversationTurn, history []store.ConversationTurn) error {
	if s.publisher == nil {
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

	return s.publisher.PublishTurnCompleted(ctx, conv.PublishInput{
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

func buildConversationMessages(history []store.ConversationTurn) []llmclient.Message {
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

func extractMissingItems(history []store.ConversationTurn) []string {
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
