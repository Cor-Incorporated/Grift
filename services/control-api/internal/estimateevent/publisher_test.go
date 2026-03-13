package estimateevent

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

type fakeMessagePublisher struct {
	topic       string
	orderingKey string
	data        []byte
}

func (f *fakeMessagePublisher) Publish(_ context.Context, topic string, orderingKey string, data []byte) error {
	f.topic = topic
	f.orderingKey = orderingKey
	f.data = data
	return nil
}

func TestPublisherPublishEstimateRequested(t *testing.T) {
	pub := &fakeMessagePublisher{}
	publisher := NewPublisher(pub, "")
	tenantID := uuid.New()
	estimateID := uuid.New()
	caseID := uuid.New()

	err := publisher.PublishEstimateRequested(context.Background(), EstimateRequestedInput{
		TenantID:   tenantID,
		EstimateID: estimateID,
		CaseID:     caseID,
		Mode:       "market_comparison",
		Region:     "japan",
	})
	if err != nil {
		t.Fatalf("PublishEstimateRequested() error = %v", err)
	}
	if pub.topic != "estimate-events" {
		t.Fatalf("topic = %q, want %q", pub.topic, "estimate-events")
	}
	if pub.orderingKey != estimateID.String() {
		t.Fatalf("orderingKey = %q, want %q", pub.orderingKey, estimateID.String())
	}

	var event map[string]any
	if err := json.Unmarshal(pub.data, &event); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if event["event_type"] != "EstimateRequested" {
		t.Fatalf("event_type = %v, want EstimateRequested", event["event_type"])
	}
	if event["aggregate_type"] != "estimate" {
		t.Fatalf("aggregate_type = %v, want estimate", event["aggregate_type"])
	}
	if event["source_domain"] != "estimation" {
		t.Fatalf("source_domain = %v, want estimation", event["source_domain"])
	}
	if event["producer"] != "control-api" {
		t.Fatalf("producer = %v, want control-api", event["producer"])
	}

	payload := event["payload"].(map[string]any)
	if payload["estimate_id"] != estimateID.String() {
		t.Fatalf("payload estimate_id = %v, want %q", payload["estimate_id"], estimateID.String())
	}
	if payload["case_id"] != caseID.String() {
		t.Fatalf("payload case_id = %v, want %q", payload["case_id"], caseID.String())
	}
	if payload["mode"] != "market_comparison" {
		t.Fatalf("payload mode = %v, want market_comparison", payload["mode"])
	}
}

func TestPublisherPublishEstimateCompleted(t *testing.T) {
	pub := &fakeMessagePublisher{}
	publisher := NewPublisher(pub, "test-topic")
	tenantID := uuid.New()
	estimateID := uuid.New()
	caseID := uuid.New()

	err := publisher.PublishEstimateCompleted(context.Background(), EstimateCompletedInput{
		TenantID:   tenantID,
		EstimateID: estimateID,
		CaseID:     caseID,
		Status:     "ready",
	})
	if err != nil {
		t.Fatalf("PublishEstimateCompleted() error = %v", err)
	}
	if pub.topic != "test-topic" {
		t.Fatalf("topic = %q, want %q", pub.topic, "test-topic")
	}

	var event map[string]any
	if err := json.Unmarshal(pub.data, &event); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if event["event_type"] != "EstimateCompleted" {
		t.Fatalf("event_type = %v, want EstimateCompleted", event["event_type"])
	}

	payload := event["payload"].(map[string]any)
	if payload["status"] != "ready" {
		t.Fatalf("payload status = %v, want ready", payload["status"])
	}
}

func TestPublisherPublishEstimateRequestedValidation(t *testing.T) {
	tests := []struct {
		name  string
		input EstimateRequestedInput
	}{
		{
			name:  "nil tenant",
			input: EstimateRequestedInput{EstimateID: uuid.New(), CaseID: uuid.New()},
		},
		{
			name:  "nil estimate",
			input: EstimateRequestedInput{TenantID: uuid.New(), CaseID: uuid.New()},
		},
		{
			name:  "nil case",
			input: EstimateRequestedInput{TenantID: uuid.New(), EstimateID: uuid.New()},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pub := &fakeMessagePublisher{}
			publisher := NewPublisher(pub, "")
			err := publisher.PublishEstimateRequested(context.Background(), tt.input)
			if err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestPublisherNilPublisher(t *testing.T) {
	var publisher *Publisher
	err := publisher.PublishEstimateRequested(context.Background(), EstimateRequestedInput{
		TenantID:   uuid.New(),
		EstimateID: uuid.New(),
		CaseID:     uuid.New(),
	})
	if err == nil {
		t.Fatal("expected error for nil publisher")
	}
}
