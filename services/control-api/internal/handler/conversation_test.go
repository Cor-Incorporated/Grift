package handler

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestBuildConversationMessagesIncludesSystemPromptAndHistory(t *testing.T) {
	turns := []conversationTurnResponse{
		{
			ID:        uuid.New(),
			CaseID:    uuid.New(),
			Role:      "user",
			Content:   "予算は100万円です",
			Metadata:  map[string]any{},
			CreatedAt: time.Now(),
		},
	}

	messages := buildConversationMessages(turns)
	if len(messages) != 2 {
		t.Fatalf("len(messages) = %d, want 2", len(messages))
	}
	if messages[0].Role != "system" {
		t.Fatalf("messages[0].Role = %q, want system", messages[0].Role)
	}
	if messages[1].Content != "予算は100万円です" {
		t.Fatalf("messages[1].Content = %q", messages[1].Content)
	}
}

func TestExtractMissingItemsPrefersLatestMetadata(t *testing.T) {
	turns := []conversationTurnResponse{
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
