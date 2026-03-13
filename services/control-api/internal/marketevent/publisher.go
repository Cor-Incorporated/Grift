package marketevent

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	defaultTopicName     = "market-research"
	defaultEventType     = "market.research.requested"
	defaultAggregateType = "market_evidence"
	defaultProducerName  = "control-api"
)

// MessagePublisher abstracts the transport layer.
type MessagePublisher interface {
	Publish(ctx context.Context, topic string, orderingKey string, data []byte) error
}

// PublishInput is the input contract for market research request publication.
type PublishInput struct {
	TenantID   uuid.UUID
	EvidenceID uuid.UUID
	CaseID     *uuid.UUID
	CaseType   string
	Context    string
	Region     string
	Providers  []string
}

// Publisher emits market.research.requested events.
type Publisher struct {
	messagePublisher MessagePublisher
	topic            string
	now              func() time.Time
	newUUID          func() uuid.UUID
}

// NewPublisher creates a Publisher for market evidence events.
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

// PublishRequested publishes one market research request event.
func (p *Publisher) PublishRequested(ctx context.Context, input PublishInput) error {
	if p == nil || p.messagePublisher == nil {
		return fmt.Errorf("market publisher is not initialized")
	}
	if input.TenantID == uuid.Nil {
		return fmt.Errorf("tenant_id is required")
	}
	if input.EvidenceID == uuid.Nil {
		return fmt.Errorf("evidence_id is required")
	}
	if input.CaseType == "" {
		return fmt.Errorf("case_type is required")
	}
	if input.Context == "" {
		return fmt.Errorf("context is required")
	}

	eventID := p.newUUID()
	event := envelope{
		EventID:        eventID.String(),
		EventType:      defaultEventType,
		TenantID:       input.TenantID.String(),
		AggregateType:  defaultAggregateType,
		AggregateID:    input.EvidenceID.String(),
		IdempotencyKey: input.EvidenceID.String(),
		OccurredAt:     p.now().UTC().Format(time.RFC3339),
		Producer:       defaultProducerName,
		Payload: payload{
			EvidenceID: input.EvidenceID.String(),
			TenantID:   input.TenantID.String(),
			CaseType:   input.CaseType,
			Context:    input.Context,
			Region:     input.Region,
			Providers:  input.Providers,
		},
	}
	if input.CaseID != nil && *input.CaseID != uuid.Nil {
		caseID := input.CaseID.String()
		event.Payload.CaseID = &caseID
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal market.research.requested event: %w", err)
	}
	return p.messagePublisher.Publish(ctx, p.topic, input.EvidenceID.String(), data)
}

type envelope struct {
	EventID        string  `json:"event_id"`
	EventType      string  `json:"event_type"`
	TenantID       string  `json:"tenant_id"`
	AggregateType  string  `json:"aggregate_type"`
	AggregateID    string  `json:"aggregate_id"`
	IdempotencyKey string  `json:"idempotency_key"`
	OccurredAt     string  `json:"occurred_at"`
	Producer       string  `json:"producer"`
	Payload        payload `json:"payload"`
}

type payload struct {
	EvidenceID string   `json:"evidence_id"`
	TenantID   string   `json:"tenant_id"`
	CaseID     *string  `json:"case_id,omitempty"`
	CaseType   string   `json:"case_type"`
	Context    string   `json:"context"`
	Region     string   `json:"region"`
	Providers  []string `json:"providers,omitempty"`
}
