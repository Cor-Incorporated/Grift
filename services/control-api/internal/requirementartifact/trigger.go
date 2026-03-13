package requirementartifact

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	conv "github.com/Cor-Incorporated/Grift/services/control-api/internal/conversation"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

const (
	defaultTopicName      = "conversation-turns"
	completenessThreshold = 0.8
	completenessEventType = "observation.completeness.updated"
	completenessSchema    = "1.0.0"
	completenessAggregate = "observation"
	completenessProducer  = "control-api"
	completenessDomain    = "estimation"
	queueStatus           = "queued"
)

var ErrCompletenessObservationNotFound = errors.New("completeness observation not found")

// Trigger publishes a completeness event that the worker can use to generate a requirement artifact.
type Trigger interface {
	Trigger(ctx context.Context, tenantID, caseID uuid.UUID) (*GenerationAccepted, error)
}

// GenerationAccepted is the HTTP-facing accepted response body.
type GenerationAccepted struct {
	Status              string    `json:"status"`
	CaseID              uuid.UUID `json:"case_id"`
	OverallCompleteness float64   `json:"overall_completeness"`
	SuggestedNextTopics []string  `json:"suggested_next_topics"`
}

// CompletenessThresholdError indicates that the manual trigger was rejected because the checklist is still incomplete.
type CompletenessThresholdError struct {
	OverallCompleteness float64
	SuggestedNextTopics []string
}

func (e *CompletenessThresholdError) Error() string {
	return fmt.Sprintf("completeness %.3f is below the %.1f threshold", e.OverallCompleteness, completenessThreshold)
}

// PubSubTrigger re-publishes the latest completeness observation to Pub/Sub.
type PubSubTrigger struct {
	observationStore store.CompletenessStore
	publisher        conv.MessagePublisher
	topic            string
	now              func() time.Time
	newUUID          func() uuid.UUID
}

// NewPubSubTrigger builds a trigger backed by the completeness store and Pub/Sub transport.
func NewPubSubTrigger(
	observationStore store.CompletenessStore,
	publisher conv.MessagePublisher,
	topic string,
) *PubSubTrigger {
	if topic == "" {
		topic = defaultTopicName
	}
	return &PubSubTrigger{
		observationStore: observationStore,
		publisher:        publisher,
		topic:            topic,
		now:              time.Now,
		newUUID:          uuid.New,
	}
}

// Trigger publishes the latest completeness snapshot when the threshold is met.
func (t *PubSubTrigger) Trigger(ctx context.Context, tenantID, caseID uuid.UUID) (*GenerationAccepted, error) {
	if t == nil || t.observationStore == nil || t.publisher == nil {
		return nil, fmt.Errorf("requirement artifact trigger is not configured")
	}
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if caseID == uuid.Nil {
		return nil, fmt.Errorf("case_id is required")
	}

	observation, err := t.observationStore.GetByCaseID(ctx, tenantID, caseID)
	if err != nil {
		return nil, fmt.Errorf("load completeness observation: %w", err)
	}
	if observation == nil {
		return nil, ErrCompletenessObservationNotFound
	}
	if observation.OverallCompleteness < completenessThreshold {
		return nil, &CompletenessThresholdError{
			OverallCompleteness: observation.OverallCompleteness,
			SuggestedNextTopics: append([]string(nil), observation.SuggestedNextTopics...),
		}
	}

	eventID := t.newUUID()
	aggregateVersion := observation.TurnCount
	if aggregateVersion <= 0 {
		aggregateVersion = 1
	}

	payload := completenessEnvelope{
		EventID:          eventID.String(),
		EventType:        completenessEventType,
		SchemaVersion:    completenessSchema,
		AggregateType:    completenessAggregate,
		AggregateID:      caseID.String(),
		AggregateVersion: aggregateVersion,
		IdempotencyKey:   fmt.Sprintf("%s:%d:manual-requirement-artifact", caseID.String(), aggregateVersion),
		OccurredAt:       t.now().UTC().Format(time.RFC3339),
		Producer:         completenessProducer,
		TenantID:         tenantID.String(),
		SourceDomain:     completenessDomain,
		Payload: completenessPayload{
			SessionID:           caseID.String(),
			Checklist:           observation.Checklist,
			OverallCompleteness: observation.OverallCompleteness,
			SuggestedNextTopics: append([]string(nil), observation.SuggestedNextTopics...),
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal completeness trigger event: %w", err)
	}
	if err := t.publisher.Publish(ctx, t.topic, caseID.String(), data); err != nil {
		return nil, fmt.Errorf("publish completeness trigger event: %w", err)
	}

	return &GenerationAccepted{
		Status:              queueStatus,
		CaseID:              caseID,
		OverallCompleteness: observation.OverallCompleteness,
		SuggestedNextTopics: append([]string(nil), observation.SuggestedNextTopics...),
	}, nil
}

type completenessEnvelope struct {
	EventID          string              `json:"event_id"`
	EventType        string              `json:"event_type"`
	SchemaVersion    string              `json:"schema_version"`
	AggregateType    string              `json:"aggregate_type"`
	AggregateID      string              `json:"aggregate_id"`
	AggregateVersion int                 `json:"aggregate_version"`
	IdempotencyKey   string              `json:"idempotency_key"`
	OccurredAt       string              `json:"occurred_at"`
	Producer         string              `json:"producer"`
	TenantID         string              `json:"tenant_id"`
	SourceDomain     string              `json:"source_domain"`
	Payload          completenessPayload `json:"payload"`
}

type completenessPayload struct {
	SessionID           string                                     `json:"session_id"`
	Checklist           map[string]store.CompletenessChecklistItem `json:"checklist"`
	OverallCompleteness float64                                    `json:"overall_completeness"`
	SuggestedNextTopics []string                                   `json:"suggested_next_topics"`
}
