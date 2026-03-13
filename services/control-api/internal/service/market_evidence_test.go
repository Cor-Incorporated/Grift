package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/marketevent"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

type mockMarketEvidenceStore struct {
	getByIDFn func(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error)
}

func (m *mockMarketEvidenceStore) GetByID(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, tenantID, evidenceID)
	}
	return nil, nil
}

type fakeMarketMessagePublisher struct {
	data []byte
}

func (f *fakeMarketMessagePublisher) Publish(_ context.Context, _ string, _ string, data []byte) error {
	f.data = data
	return nil
}

func TestMarketEvidenceServiceQueueCollection(t *testing.T) {
	messagePublisher := &fakeMarketMessagePublisher{}
	publisher := marketevent.NewPublisher(messagePublisher, "market-topic")
	service := NewMarketEvidenceService(nil, publisher)
	tenantID := uuid.New()
	evidenceID := uuid.New()

	err := service.QueueCollection(context.Background(), CollectMarketEvidenceInput{
		TenantID:   tenantID,
		EvidenceID: evidenceID,
		CaseType:   domain.CaseTypeNewProject,
		Context:    "Build analytics product",
	})
	if err != nil {
		t.Fatalf("QueueCollection() error = %v", err)
	}

	var event map[string]any
	if err := json.Unmarshal(messagePublisher.data, &event); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	payload := event["payload"].(map[string]any)
	providers := payload["providers"].([]any)
	if len(providers) != 4 {
		t.Fatalf("len(providers) = %d, want 4", len(providers))
	}
	if payload["region"] != "japan" {
		t.Fatalf("region = %v, want japan", payload["region"])
	}
}

func TestMarketEvidenceServiceQueueCollectionRejectsContextOverLimit(t *testing.T) {
	messagePublisher := &fakeMarketMessagePublisher{}
	publisher := marketevent.NewPublisher(messagePublisher, "market-topic")
	service := NewMarketEvidenceService(nil, publisher)

	err := service.QueueCollection(context.Background(), CollectMarketEvidenceInput{
		TenantID:   uuid.New(),
		EvidenceID: uuid.New(),
		CaseType:   domain.CaseTypeNewProject,
		Context:    strings.Repeat("a", 10001),
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
	if err.Error() != "context must be 10000 characters or less" {
		t.Fatalf("error = %q, want %q", err.Error(), "context must be 10000 characters or less")
	}
	if len(messagePublisher.data) != 0 {
		t.Fatal("publisher should not be called when validation fails")
	}
}

func TestMarketEvidenceServiceGetByID(t *testing.T) {
	tenantID := uuid.New()
	evidenceID := uuid.New()
	now := time.Now()
	svc := NewMarketEvidenceService(&mockMarketEvidenceStore{
		getByIDFn: func(_ context.Context, gotTenantID, gotEvidenceID uuid.UUID) (*domain.AggregatedEvidence, error) {
			if gotTenantID != tenantID || gotEvidenceID != evidenceID {
				t.Fatalf("unexpected IDs")
			}
			return &domain.AggregatedEvidence{
				ID:                evidenceID,
				TenantID:          tenantID,
				OverallConfidence: "medium",
				AggregatedAt:      now,
			}, nil
		},
	}, nil)

	record, err := svc.GetByID(context.Background(), tenantID, evidenceID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if record == nil || record.ID != evidenceID {
		t.Fatalf("record = %#v, want ID %s", record, evidenceID)
	}
}

var _ store.MarketEvidenceStore = (*mockMarketEvidenceStore)(nil)
