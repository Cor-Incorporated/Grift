package marketevent

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

func TestPublisherPublishRequested(t *testing.T) {
	pub := &fakeMessagePublisher{}
	publisher := NewPublisher(pub, "")
	tenantID := uuid.New()
	evidenceID := uuid.New()

	err := publisher.PublishRequested(context.Background(), PublishInput{
		TenantID:   tenantID,
		EvidenceID: evidenceID,
		CaseType:   "new_project",
		Context:    "Build analytics product",
		Region:     "japan",
		Providers:  []string{"grok", "brave"},
	})
	if err != nil {
		t.Fatalf("PublishRequested() error = %v", err)
	}
	if pub.topic != "market-research" {
		t.Fatalf("topic = %q, want %q", pub.topic, "market-research")
	}
	if pub.orderingKey != evidenceID.String() {
		t.Fatalf("orderingKey = %q, want %q", pub.orderingKey, evidenceID.String())
	}

	var event map[string]any
	if err := json.Unmarshal(pub.data, &event); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if event["event_type"] != "market.research.requested" {
		t.Fatalf("event_type = %v, want market.research.requested", event["event_type"])
	}
	payload := event["payload"].(map[string]any)
	if payload["evidence_id"] != evidenceID.String() {
		t.Fatalf("payload evidence_id = %v, want %q", payload["evidence_id"], evidenceID.String())
	}
}
