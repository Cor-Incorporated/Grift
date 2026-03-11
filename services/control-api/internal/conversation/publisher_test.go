package conversation

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

type capturedMessage struct {
	topic       string
	orderingKey string
	data        []byte
}

type fakeMessagePublisher struct {
	messages []capturedMessage
}

func (f *fakeMessagePublisher) Publish(_ context.Context, topic string, orderingKey string, data []byte) error {
	f.messages = append(f.messages, capturedMessage{
		topic:       topic,
		orderingKey: orderingKey,
		data:        data,
	})
	return nil
}

func TestPublishTurnCompleted_BuildsEventEnvelopeAndOrderingKey(t *testing.T) {
	t.Parallel()

	pub := &fakeMessagePublisher{}
	sut := NewPublisher(pub, "conversation-turns")
	fixedNow := time.Date(2026, 3, 12, 1, 2, 3, 0, time.UTC)
	fixedEventID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	sut.now = func() time.Time { return fixedNow }
	sut.newUUID = func() uuid.UUID { return fixedEventID }

	tenantID := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	sessionID := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	correlationID := uuid.MustParse("44444444-4444-4444-8444-444444444444")

	err := sut.PublishTurnCompleted(context.Background(), PublishInput{
		TenantID:   tenantID,
		SessionID:  sessionID,
		TurnNumber: 5,
		Role:       "assistant",
		Content:    "next question",
		PreviousTurns: []Turn{
			{Role: "user", Content: "t2", TurnNumber: 2},
			{Role: "assistant", Content: "t3", TurnNumber: 3},
			{Role: "user", Content: "t4", TurnNumber: 4},
			{Role: "user", Content: "future", TurnNumber: 7},
		},
		SystemPromptVersion: "v3",
		ModelUsed:           "qwen3.5-32b",
		FallbackUsed:        true,
		CorrelationID:       &correlationID,
	})
	if err != nil {
		t.Fatalf("PublishTurnCompleted returned error: %v", err)
	}

	if got, want := len(pub.messages), 1; got != want {
		t.Fatalf("published messages = %d, want %d", got, want)
	}

	msg := pub.messages[0]
	if got, want := msg.topic, "conversation-turns"; got != want {
		t.Errorf("topic = %q, want %q", got, want)
	}
	if got, want := msg.orderingKey, sessionID.String(); got != want {
		t.Errorf("ordering key = %q, want %q", got, want)
	}

	var event envelope
	if err := json.Unmarshal(msg.data, &event); err != nil {
		t.Fatalf("failed to unmarshal event json: %v", err)
	}

	if got, want := event.EventType, "conversation.turn.completed"; got != want {
		t.Errorf("event_type = %q, want %q", got, want)
	}
	if got, want := event.AggregateType, "conversation"; got != want {
		t.Errorf("aggregate_type = %q, want %q", got, want)
	}
	if got, want := event.AggregateID, sessionID.String(); got != want {
		t.Errorf("aggregate_id = %q, want %q", got, want)
	}
	if got, want := event.AggregateVersion, 5; got != want {
		t.Errorf("aggregate_version = %d, want %d", got, want)
	}
	if got, want := event.IdempotencyKey, sessionID.String()+":5"; got != want {
		t.Errorf("idempotency_key = %q, want %q", got, want)
	}
	if got, want := event.OccurredAt, fixedNow.Format(time.RFC3339); got != want {
		t.Errorf("occurred_at = %q, want %q", got, want)
	}
	if event.CorrelationID == nil || *event.CorrelationID != correlationID.String() {
		t.Errorf("correlation_id = %v, want %s", event.CorrelationID, correlationID.String())
	}

	if got, want := len(event.Payload.PreviousTurns), 3; got != want {
		t.Fatalf("previous_turns count = %d, want %d", got, want)
	}
	if event.Payload.PreviousTurns[0].TurnNumber != 2 ||
		event.Payload.PreviousTurns[1].TurnNumber != 3 ||
		event.Payload.PreviousTurns[2].TurnNumber != 4 {
		t.Errorf("previous_turns not normalized as expected: %+v", event.Payload.PreviousTurns)
	}
}

func TestPublishTurnCompleted_ValidationErrors(t *testing.T) {
	t.Parallel()

	sut := NewPublisher(&fakeMessagePublisher{}, "")
	tests := []PublishInput{
		{},
		{TenantID: uuid.New()},
		{TenantID: uuid.New(), SessionID: uuid.New(), TurnNumber: 0},
		{TenantID: uuid.New(), SessionID: uuid.New(), TurnNumber: 1},
	}

	for i, input := range tests {
		input := input
		t.Run(string(rune('a'+i)), func(t *testing.T) {
			t.Parallel()
			if err := sut.PublishTurnCompleted(context.Background(), input); err == nil {
				t.Fatalf("expected validation error for input #%d", i)
			}
		})
	}
}
