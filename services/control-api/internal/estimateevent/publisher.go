package estimateevent

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	defaultTopicName     = "estimate-events"
	defaultProducerName  = "control-api"
	defaultAggregateType = "estimate"
	defaultSourceDomain  = "estimation"

	eventTypeEstimateRequested = "EstimateRequested"
	eventTypeEstimateCompleted = "EstimateCompleted"
)

// MessagePublisher abstracts the transport layer.
type MessagePublisher interface {
	Publish(ctx context.Context, topic string, orderingKey string, data []byte) error
}

// EstimateRequestedInput is the input for publishing an EstimateRequested event.
type EstimateRequestedInput struct {
	TenantID   uuid.UUID
	EstimateID uuid.UUID
	CaseID     uuid.UUID
	Mode       string
	Region     string
}

// EstimateCompletedInput is the input for publishing an EstimateCompleted event.
type EstimateCompletedInput struct {
	TenantID   uuid.UUID
	EstimateID uuid.UUID
	CaseID     uuid.UUID
	Status     string
}

// Publisher emits estimate lifecycle events.
type Publisher struct {
	messagePublisher MessagePublisher
	topic            string
	now              func() time.Time
	newUUID          func() uuid.UUID
}

// NewPublisher creates a Publisher for estimate events.
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

// PublishEstimateRequested publishes an EstimateRequested event.
func (p *Publisher) PublishEstimateRequested(ctx context.Context, input EstimateRequestedInput) error {
	if p == nil || p.messagePublisher == nil {
		return fmt.Errorf("estimate publisher is not initialized")
	}
	if input.TenantID == uuid.Nil {
		return fmt.Errorf("tenant_id is required")
	}
	if input.EstimateID == uuid.Nil {
		return fmt.Errorf("estimate_id is required")
	}
	if input.CaseID == uuid.Nil {
		return fmt.Errorf("case_id is required")
	}

	eventID := p.newUUID()
	event := envelope{
		EventID:        eventID.String(),
		EventType:      eventTypeEstimateRequested,
		TenantID:       input.TenantID.String(),
		AggregateType:  defaultAggregateType,
		AggregateID:    input.EstimateID.String(),
		IdempotencyKey: input.EstimateID.String(),
		OccurredAt:     p.now().UTC().Format(time.RFC3339),
		Producer:       defaultProducerName,
		SourceDomain:   defaultSourceDomain,
		Payload: requestedPayload{
			EstimateID: input.EstimateID.String(),
			TenantID:   input.TenantID.String(),
			CaseID:     input.CaseID.String(),
			Mode:       input.Mode,
			Region:     input.Region,
		},
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal EstimateRequested event: %w", err)
	}
	return p.messagePublisher.Publish(ctx, p.topic, input.EstimateID.String(), data)
}

// PublishEstimateCompleted publishes an EstimateCompleted event.
func (p *Publisher) PublishEstimateCompleted(ctx context.Context, input EstimateCompletedInput) error {
	if p == nil || p.messagePublisher == nil {
		return fmt.Errorf("estimate publisher is not initialized")
	}
	if input.TenantID == uuid.Nil {
		return fmt.Errorf("tenant_id is required")
	}
	if input.EstimateID == uuid.Nil {
		return fmt.Errorf("estimate_id is required")
	}
	if input.CaseID == uuid.Nil {
		return fmt.Errorf("case_id is required")
	}

	eventID := p.newUUID()
	event := envelope{
		EventID:        eventID.String(),
		EventType:      eventTypeEstimateCompleted,
		TenantID:       input.TenantID.String(),
		AggregateType:  defaultAggregateType,
		AggregateID:    input.EstimateID.String(),
		IdempotencyKey: input.EstimateID.String() + ":completed",
		OccurredAt:     p.now().UTC().Format(time.RFC3339),
		Producer:       defaultProducerName,
		SourceDomain:   defaultSourceDomain,
		Payload: completedPayload{
			EstimateID: input.EstimateID.String(),
			TenantID:   input.TenantID.String(),
			CaseID:     input.CaseID.String(),
			Status:     input.Status,
		},
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal EstimateCompleted event: %w", err)
	}
	return p.messagePublisher.Publish(ctx, p.topic, input.EstimateID.String(), data)
}

type envelope struct {
	EventID        string `json:"event_id"`
	EventType      string `json:"event_type"`
	TenantID       string `json:"tenant_id"`
	AggregateType  string `json:"aggregate_type"`
	AggregateID    string `json:"aggregate_id"`
	IdempotencyKey string `json:"idempotency_key"`
	OccurredAt     string `json:"occurred_at"`
	Producer       string `json:"producer"`
	SourceDomain   string `json:"source_domain"`
	Payload        any    `json:"payload"`
}

type requestedPayload struct {
	EstimateID string `json:"estimate_id"`
	TenantID   string `json:"tenant_id"`
	CaseID     string `json:"case_id"`
	Mode       string `json:"mode"`
	Region     string `json:"region"`
}

type completedPayload struct {
	EstimateID string `json:"estimate_id"`
	TenantID   string `json:"tenant_id"`
	CaseID     string `json:"case_id"`
	Status     string `json:"status"`
}
