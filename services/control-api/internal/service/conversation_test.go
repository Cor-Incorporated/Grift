package service

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/llmclient"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

// mockConversationStore is a test double for store.ConversationStore.
type mockConversationStore struct {
	listTurnsFunc      func(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]store.ConversationTurn, int, error)
	insertTurnFunc     func(ctx context.Context, tenantID, caseID uuid.UUID, role, content string, metadata map[string]any) (*store.ConversationTurn, error)
	ensureCaseExistsFunc func(ctx context.Context, tenantID, caseID uuid.UUID) error
}

func (m *mockConversationStore) ListTurns(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]store.ConversationTurn, int, error) {
	if m.listTurnsFunc != nil {
		return m.listTurnsFunc(ctx, tenantID, caseID, limit, offset)
	}
	return nil, 0, nil
}

func (m *mockConversationStore) InsertTurn(ctx context.Context, tenantID, caseID uuid.UUID, role, content string, metadata map[string]any) (*store.ConversationTurn, error) {
	if m.insertTurnFunc != nil {
		return m.insertTurnFunc(ctx, tenantID, caseID, role, content, metadata)
	}
	return &store.ConversationTurn{
		ID:         uuid.New(),
		CaseID:     caseID,
		Role:       role,
		Content:    content,
		Metadata:   metadata,
		TurnNumber: 1,
	}, nil
}

func (m *mockConversationStore) EnsureCaseExists(ctx context.Context, tenantID, caseID uuid.UUID) error {
	if m.ensureCaseExistsFunc != nil {
		return m.ensureCaseExistsFunc(ctx, tenantID, caseID)
	}
	return nil
}

// mockLLMClient is a test double for LLMClient.
type mockLLMClient struct {
	completeFunc func(ctx context.Context, messages []llmclient.Message, opts llmclient.CompletionOptions) (*llmclient.CompletionResponse, error)
}

func (m *mockLLMClient) Complete(ctx context.Context, messages []llmclient.Message, opts llmclient.CompletionOptions) (*llmclient.CompletionResponse, error) {
	if m.completeFunc != nil {
		return m.completeFunc(ctx, messages, opts)
	}
	return &llmclient.CompletionResponse{
		Content: "assistant response",
		Model:   "stub",
	}, nil
}

func TestListTurns(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()

	tests := []struct {
		name      string
		store     *mockConversationStore
		wantCount int
		wantTotal int
		wantErr   bool
	}{
		{
			name: "returns turns from store",
			store: &mockConversationStore{
				listTurnsFunc: func(_ context.Context, _, _ uuid.UUID, _, _ int) ([]store.ConversationTurn, int, error) {
					return []store.ConversationTurn{
						{ID: uuid.New(), Role: "user", Content: "hello"},
						{ID: uuid.New(), Role: "assistant", Content: "hi"},
					}, 2, nil
				},
			},
			wantCount: 2,
			wantTotal: 2,
		},
		{
			name: "propagates store error",
			store: &mockConversationStore{
				listTurnsFunc: func(_ context.Context, _, _ uuid.UUID, _, _ int) ([]store.ConversationTurn, int, error) {
					return nil, 0, fmt.Errorf("db error")
				},
			},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewConversationService(tt.store, nil, nil)
			turns, total, err := svc.ListTurns(context.Background(), tenantID, caseID, 20, 0)
			if (err != nil) != tt.wantErr {
				t.Errorf("ListTurns() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr {
				if len(turns) != tt.wantCount {
					t.Errorf("ListTurns() count = %d, want %d", len(turns), tt.wantCount)
				}
				if total != tt.wantTotal {
					t.Errorf("ListTurns() total = %d, want %d", total, tt.wantTotal)
				}
			}
		})
	}
}

func TestSendMessage(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()

	tests := []struct {
		name    string
		store   *mockConversationStore
		llm     *mockLLMClient
		wantErr bool
		errMsg  string
	}{
		{
			name:  "success flow",
			store: &mockConversationStore{},
			llm:   &mockLLMClient{},
		},
		{
			name: "case not found",
			store: &mockConversationStore{
				ensureCaseExistsFunc: func(_ context.Context, _, _ uuid.UUID) error {
					return sql.ErrNoRows
				},
			},
			llm:     &mockLLMClient{},
			wantErr: true,
			errMsg:  "case not found",
		},
		{
			name:  "llm failure",
			store: &mockConversationStore{},
			llm: &mockLLMClient{
				completeFunc: func(_ context.Context, _ []llmclient.Message, _ llmclient.CompletionOptions) (*llmclient.CompletionResponse, error) {
					return nil, fmt.Errorf("gateway timeout")
				},
			},
			wantErr: true,
			errMsg:  "llm request failed",
		},
		{
			name: "insert user turn failure",
			store: &mockConversationStore{
				insertTurnFunc: func(_ context.Context, _, _ uuid.UUID, role, _ string, _ map[string]any) (*store.ConversationTurn, error) {
					if role == "user" {
						return nil, fmt.Errorf("db write error")
					}
					return &store.ConversationTurn{
						ID:         uuid.New(),
						CaseID:     caseID,
						Role:       role,
						TurnNumber: 1,
					}, nil
				},
			},
			llm:     &mockLLMClient{},
			wantErr: true,
			errMsg:  "failed to save user turn",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewConversationService(tt.store, nil, tt.llm)
			result, err := svc.SendMessage(context.Background(), SendMessageInput{
				TenantID: tenantID,
				CaseID:   caseID,
				Content:  "test message",
			})
			if (err != nil) != tt.wantErr {
				t.Errorf("SendMessage() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr {
				if tt.errMsg != "" && err != nil {
					if got := err.Error(); len(got) < len(tt.errMsg) || got[:len(tt.errMsg)] != tt.errMsg {
						t.Errorf("SendMessage() error = %q, want prefix %q", got, tt.errMsg)
					}
				}
				return
			}
			if result == nil || result.AssistantTurn == nil {
				t.Fatal("SendMessage() returned nil result")
			}
			if result.AssistantTurn.Role != "assistant" {
				t.Errorf("AssistantTurn.Role = %q, want assistant", result.AssistantTurn.Role)
			}
		})
	}
}

func TestBuildConversationMessagesIncludesSystemPromptAndHistory(t *testing.T) {
	turns := []store.ConversationTurn{
		{
			ID:       uuid.New(),
			CaseID:   uuid.New(),
			Role:     "user",
			Content:  "budget is 1M yen",
			Metadata: map[string]any{},
		},
	}

	messages := buildConversationMessages(turns)
	if len(messages) != 2 {
		t.Fatalf("len(messages) = %d, want 2", len(messages))
	}
	if messages[0].Role != "system" {
		t.Fatalf("messages[0].Role = %q, want system", messages[0].Role)
	}
	if messages[1].Content != "budget is 1M yen" {
		t.Fatalf("messages[1].Content = %q", messages[1].Content)
	}
}

func TestExtractMissingItemsPrefersLatestMetadata(t *testing.T) {
	turns := []store.ConversationTurn{
		{
			Metadata: map[string]any{
				"missing_items": []any{"budget_range"},
			},
		},
		{
			Metadata: map[string]any{
				"missing_items": []any{"deadline", "scope"},
			},
		},
	}

	items := extractMissingItems(turns)
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
	if items[0] != "deadline" || items[1] != "scope" {
		t.Fatalf("items = %v, want [deadline scope]", items)
	}
}
