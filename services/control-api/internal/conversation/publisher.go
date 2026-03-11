package conversation

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
)

const (
	defaultTopicName        = "conversation-turns"
	defaultPreviousTurnSize = 3
	defaultAggregateType    = "conversation"
	defaultEventType        = "conversation.turn.completed"
	defaultProducerName     = "control-api"
	defaultSourceDomain     = "estimation"
)

// MessagePublisher abstracts the transport layer (Pub/Sub, test double, etc.).
type MessagePublisher interface {
	Publish(ctx context.Context, topic string, orderingKey string, data []byte) error
}

// Turn contains the minimal turn representation used in the event payload.
type Turn struct {
	Role       string `json:"role"`
	Content    string `json:"content"`
	TurnNumber int    `json:"turn_number"`
}

// PublishInput is the input contract for conversation.turn.completed publication.
type PublishInput struct {
	TenantID            uuid.UUID
	SessionID           uuid.UUID
	TurnNumber          int
	Role                string
	Content             string
	PreviousTurns       []Turn
	SystemPromptVersion string
	ModelUsed           string
	FallbackUsed        bool
	CorrelationID       *uuid.UUID
	CausationID         *uuid.UUID
	SourceDomain        string
}

// Publisher emits conversation.turn.completed events.
type Publisher struct {
	messagePublisher MessagePublisher
	topic            string
	now              func() time.Time
	newUUID          func() uuid.UUID
}

// NewPublisher creates a Publisher for conversation turn completion events.
func NewPublisher(messagePublisher MessagePublisher, topic string) *Publisher {
	if topic == "" {
		topic = defaultTopicName
	}

	return &Publisher{
		messagePublisher: messagePublisher,
		topic:            topic,
		now:              time.Now,
		newUUID:          uuid.New,
	}
}

// PublishTurnCompleted publishes a conversation.turn.completed event.
func (p *Publisher) PublishTurnCompleted(ctx context.Context, input PublishInput) error {
	if p == nil || p.messagePublisher == nil {
		return fmt.Errorf("conversation publisher is not initialized")
	}
	if input.TenantID == uuid.Nil {
		return fmt.Errorf("tenant_id is required")
	}
	if input.SessionID == uuid.Nil {
		return fmt.Errorf("session_id is required")
	}
	if input.TurnNumber <= 0 {
		return fmt.Errorf("turn_number must be >= 1")
	}
	if input.Role == "" {
		return fmt.Errorf("role is required")
	}

	sourceDomain := input.SourceDomain
	if sourceDomain == "" {
		sourceDomain = defaultSourceDomain
	}

	eventID := p.newUUID()
	occurredAt := p.now().UTC()
	previousTurns := normalizePreviousTurns(input.PreviousTurns, input.TurnNumber)
	producer := defaultProducerName

	event := envelope{
		EventID:          eventID.String(),
		EventType:        defaultEventType,
		TenantID:         input.TenantID.String(),
		AggregateType:    defaultAggregateType,
		AggregateID:      input.SessionID.String(),
		AggregateVersion: input.TurnNumber,
		IdempotencyKey:   fmt.Sprintf("%s:%d", input.SessionID.String(), input.TurnNumber),
		OccurredAt:       occurredAt.Format(time.RFC3339),
		Producer:         producer,
		SourceDomain:     sourceDomain,
		Payload: payload{
			SessionID:           input.SessionID.String(),
			TurnNumber:          input.TurnNumber,
			Role:                input.Role,
			Content:             input.Content,
			PreviousTurns:       previousTurns,
			SystemPromptVersion: input.SystemPromptVersion,
			ModelUsed:           input.ModelUsed,
			FallbackUsed:        input.FallbackUsed,
		},
	}

	if input.CorrelationID != nil && *input.CorrelationID != uuid.Nil {
		correlationID := input.CorrelationID.String()
		event.CorrelationID = &correlationID
	}
	if input.CausationID != nil && *input.CausationID != uuid.Nil {
		causationID := input.CausationID.String()
		event.CausationID = &causationID
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal conversation.turn.completed event: %w", err)
	}

	return p.messagePublisher.Publish(ctx, p.topic, input.SessionID.String(), data)
}

func normalizePreviousTurns(previousTurns []Turn, currentTurn int) []Turn {
	if len(previousTurns) == 0 {
		return nil
	}

	filtered := make([]Turn, 0, len(previousTurns))
	for _, turn := range previousTurns {
		if turn.TurnNumber <= 0 || turn.TurnNumber >= currentTurn {
			continue
		}
		filtered = append(filtered, turn)
	}

	slices.SortFunc(filtered, func(a, b Turn) int {
		return a.TurnNumber - b.TurnNumber
	})

	if len(filtered) > defaultPreviousTurnSize {
		filtered = filtered[len(filtered)-defaultPreviousTurnSize:]
	}

	return filtered
}

type envelope struct {
	EventID          string  `json:"event_id"`
	EventType        string  `json:"event_type"`
	TenantID         string  `json:"tenant_id"`
	AggregateType    string  `json:"aggregate_type"`
	AggregateID      string  `json:"aggregate_id"`
	AggregateVersion int     `json:"aggregate_version"`
	IdempotencyKey   string  `json:"idempotency_key"`
	CorrelationID    *string `json:"correlation_id,omitempty"`
	CausationID      *string `json:"causation_id,omitempty"`
	OccurredAt       string  `json:"occurred_at"`
	Producer         string  `json:"producer"`
	SourceDomain     string  `json:"source_domain"`
	Payload          payload `json:"payload"`
}

type payload struct {
	SessionID           string `json:"session_id"`
	TurnNumber          int    `json:"turn_number"`
	Role                string `json:"role"`
	Content             string `json:"content"`
	PreviousTurns       []Turn `json:"previous_turns,omitempty"`
	SystemPromptVersion string `json:"system_prompt_version,omitempty"`
	ModelUsed           string `json:"model_used,omitempty"`
	FallbackUsed        bool   `json:"fallback_used"`
}
