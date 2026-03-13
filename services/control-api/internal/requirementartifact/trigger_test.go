package requirementartifact

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

type fakeCompletenessStore struct {
	observation *store.CompletenessObservation
	err         error
}

func (f *fakeCompletenessStore) GetByCaseID(_ context.Context, _, _ uuid.UUID) (*store.CompletenessObservation, error) {
	return f.observation, f.err
}

type publishedMessage struct {
	topic       string
	orderingKey string
	data        []byte
}

type fakePublisher struct {
	messages []publishedMessage
	err      error
}

func (f *fakePublisher) Publish(_ context.Context, topic string, orderingKey string, data []byte) error {
	if f.err != nil {
		return f.err
	}
	f.messages = append(f.messages, publishedMessage{
		topic:       topic,
		orderingKey: orderingKey,
		data:        data,
	})
	return nil
}

func TestPubSubTrigger_TriggerPublishesCompletenessEvent(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	publisher := &fakePublisher{}
	trigger := NewPubSubTrigger(
		&fakeCompletenessStore{
			observation: &store.CompletenessObservation{
				OverallCompleteness: 0.85,
				Checklist: map[string]store.CompletenessChecklistItem{
					"budget": {Status: store.StatusCollected, Confidence: 1},
				},
				SuggestedNextTopics: []string{"timeline"},
				TurnCount:           6,
			},
		},
		publisher,
		"requirement-artifacts",
	)
	trigger.now = func() time.Time { return time.Date(2026, 3, 13, 9, 0, 0, 0, time.UTC) }
	trigger.newUUID = func() uuid.UUID { return uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") }

	result, err := trigger.Trigger(context.Background(), tenantID, caseID)
	if err != nil {
		t.Fatalf("Trigger() error = %v", err)
	}
	if result == nil || result.Status != queueStatus {
		t.Fatalf("Trigger() result = %+v", result)
	}
	if len(publisher.messages) != 1 {
		t.Fatalf("published messages = %d, want 1", len(publisher.messages))
	}

	var envelope map[string]any
	if err := json.Unmarshal(publisher.messages[0].data, &envelope); err != nil {
		t.Fatalf("unmarshal event: %v", err)
	}
	if envelope["event_type"] != completenessEventType {
		t.Fatalf("event_type = %v, want %q", envelope["event_type"], completenessEventType)
	}
	if envelope["aggregate_version"] != float64(6) {
		t.Fatalf("aggregate_version = %v, want 6", envelope["aggregate_version"])
	}
	if publisher.messages[0].orderingKey != caseID.String() {
		t.Fatalf("orderingKey = %q, want %q", publisher.messages[0].orderingKey, caseID.String())
	}
}

func TestPubSubTrigger_TriggerRejectsBelowThreshold(t *testing.T) {
	trigger := NewPubSubTrigger(
		&fakeCompletenessStore{
			observation: &store.CompletenessObservation{
				OverallCompleteness: 0.7,
				SuggestedNextTopics: []string{"budget"},
			},
		},
		&fakePublisher{},
		"",
	)

	_, err := trigger.Trigger(context.Background(), uuid.New(), uuid.New())
	var thresholdErr *CompletenessThresholdError
	if !errors.As(err, &thresholdErr) {
		t.Fatalf("Trigger() error = %v, want CompletenessThresholdError", err)
	}
	if thresholdErr.OverallCompleteness != 0.7 {
		t.Fatalf("OverallCompleteness = %v, want 0.7", thresholdErr.OverallCompleteness)
	}
}

func TestPubSubTrigger_TriggerReturnsNotFoundWithoutObservation(t *testing.T) {
	trigger := NewPubSubTrigger(&fakeCompletenessStore{}, &fakePublisher{}, "")

	_, err := trigger.Trigger(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, ErrCompletenessObservationNotFound) {
		t.Fatalf("Trigger() error = %v, want ErrCompletenessObservationNotFound", err)
	}
}

func TestPubSubTrigger_TriggerReturnsCopiedSuggestedNextTopics(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	observation := &store.CompletenessObservation{
		OverallCompleteness: 0.9,
		SuggestedNextTopics: []string{"timeline", "budget"},
		TurnCount:           3,
	}
	trigger := NewPubSubTrigger(
		&fakeCompletenessStore{observation: observation},
		&fakePublisher{},
		"requirement-artifacts",
	)

	result, err := trigger.Trigger(context.Background(), tenantID, caseID)
	if err != nil {
		t.Fatalf("Trigger() error = %v", err)
	}
	if result == nil {
		t.Fatal("Trigger() result = nil")
	}

	observation.SuggestedNextTopics[0] = "changed-after-trigger"
	if got, want := result.SuggestedNextTopics[0], "timeline"; got != want {
		t.Fatalf("SuggestedNextTopics[0] = %q, want %q", got, want)
	}
}
