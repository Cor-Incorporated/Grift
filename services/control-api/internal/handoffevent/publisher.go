package handoffevent

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/google/uuid"
)

const (
	defaultTopicName     = "handoff-events"
	defaultEventType     = "HandoffInitiated"
	defaultAggregateType = "handoff"
	defaultAggregateVer  = 1
	defaultProducerName  = "control-api"
	defaultSourceDomain  = "handoff"
)

// MessagePublisher abstracts the transport layer.
type MessagePublisher interface {
	Publish(ctx context.Context, topic string, orderingKey string, data []byte) error
}

// Publisher emits handoff lifecycle events.
type Publisher struct {
	messagePublisher MessagePublisher
	topic            string
	now              func() time.Time
	newUUID          func() uuid.UUID
}

// NewPublisher creates a Publisher for handoff events.
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

// PublishHandoffInitiated publishes a HandoffInitiated event.
func (p *Publisher) PublishHandoffInitiated(ctx context.Context, handoff *domain.HandoffPackage) error {
	if p == nil || p.messagePublisher == nil {
		return fmt.Errorf("handoff publisher is not initialized")
	}
	if handoff == nil {
		return fmt.Errorf("handoff is required")
	}
	if handoff.TenantID == uuid.Nil {
		return fmt.Errorf("tenant_id is required")
	}
	if handoff.ID == uuid.Nil {
		return fmt.Errorf("handoff_id is required")
	}

	event := envelope{
		EventID:          p.newUUID().String(),
		EventType:        defaultEventType,
		TenantID:         handoff.TenantID.String(),
		AggregateType:    defaultAggregateType,
		AggregateID:      handoff.ID.String(),
		AggregateVersion: defaultAggregateVer,
		IdempotencyKey:   handoff.IdempotencyKey.String(),
		OccurredAt:       p.now().UTC().Format(time.RFC3339),
		Producer:         defaultProducerName,
		SourceDomain:     defaultSourceDomain,
		Payload:          newPayload(handoff),
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal HandoffInitiated event: %w", err)
	}
	return p.messagePublisher.Publish(ctx, p.topic, handoff.ID.String(), data)
}

func newPayload(handoff *domain.HandoffPackage) payload {
	return payload{
		ID:               handoff.ID.String(),
		CaseID:           handoff.CaseID.String(),
		EstimateID:       handoff.EstimateID.String(),
		LinearProjectID:  handoff.LinearProjectID,
		LinearProjectURL: handoff.LinearProjectURL,
		GithubProjectURL: handoff.GithubProjectURL,
		Status:           handoff.Status,
		ErrorMessage:     handoff.ErrorMessage,
		IdempotencyKey:   handoff.IdempotencyKey.String(),
		CreatedAt:        handoff.CreatedAt.Format(time.RFC3339),
		UpdatedAt:        handoff.UpdatedAt.Format(time.RFC3339),
	}
}

type envelope struct {
	EventID          string  `json:"event_id"`
	EventType        string  `json:"event_type"`
	TenantID         string  `json:"tenant_id"`
	AggregateType    string  `json:"aggregate_type"`
	AggregateID      string  `json:"aggregate_id"`
	AggregateVersion int     `json:"aggregate_version"`
	IdempotencyKey   string  `json:"idempotency_key"`
	OccurredAt       string  `json:"occurred_at"`
	Producer         string  `json:"producer"`
	SourceDomain     string  `json:"source_domain"`
	Payload          payload `json:"payload"`
}

type payload struct {
	ID               string               `json:"id"`
	CaseID           string               `json:"case_id"`
	EstimateID       string               `json:"estimate_id"`
	LinearProjectID  *string              `json:"linear_project_id,omitempty"`
	LinearProjectURL *string              `json:"linear_project_url,omitempty"`
	GithubProjectURL *string              `json:"github_project_url,omitempty"`
	Status           domain.HandoffStatus `json:"status"`
	ErrorMessage     *string              `json:"error_message,omitempty"`
	IdempotencyKey   string               `json:"idempotency_key"`
	CreatedAt        string               `json:"created_at"`
	UpdatedAt        string               `json:"updated_at"`
}
