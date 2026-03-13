package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/estimateevent"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

type mockEstimateStore struct {
	createFn      func(ctx context.Context, e *domain.Estimate) (*domain.Estimate, error)
	getByIDFn     func(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error)
	listByCaseFn  func(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error)
	updateTWPFn   func(ctx context.Context, tenantID, estimateID uuid.UUID, proposal json.RawMessage) error
}

func (m *mockEstimateStore) Create(ctx context.Context, e *domain.Estimate) (*domain.Estimate, error) {
	if m.createFn != nil {
		return m.createFn(ctx, e)
	}
	now := time.Now()
	e.CreatedAt = now
	e.UpdatedAt = now
	return e, nil
}

func (m *mockEstimateStore) GetByID(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, tenantID, caseID, estimateID)
	}
	return nil, nil
}

func (m *mockEstimateStore) ListByCaseID(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error) {
	if m.listByCaseFn != nil {
		return m.listByCaseFn(ctx, tenantID, caseID, limit, offset)
	}
	return nil, 0, nil
}

func (m *mockEstimateStore) UpdateThreeWayProposal(ctx context.Context, tenantID, estimateID uuid.UUID, proposal json.RawMessage) error {
	if m.updateTWPFn != nil {
		return m.updateTWPFn(ctx, tenantID, estimateID, proposal)
	}
	return nil
}

type fakeEstimateMessagePublisher struct {
	data []byte
}

func (f *fakeEstimateMessagePublisher) Publish(_ context.Context, _ string, _ string, data []byte) error {
	f.data = data
	return nil
}

func TestEstimateServiceCreate(t *testing.T) {
	messagePub := &fakeEstimateMessagePublisher{}
	publisher := estimateevent.NewPublisher(messagePub, "estimate-topic")
	svc := NewEstimateService(&mockEstimateStore{}, publisher)
	tenantID := uuid.New()
	caseID := uuid.New()

	result, err := svc.Create(context.Background(), CreateEstimateInput{
		TenantID:              tenantID,
		CaseID:                caseID,
		YourHourlyRate:        15000,
		IncludeMarketEvidence: true,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if result == nil {
		t.Fatal("Create() returned nil")
	}
	if result.EstimateMode != domain.EstimateModeMarketComparison {
		t.Fatalf("EstimateMode = %q, want %q", result.EstimateMode, domain.EstimateModeMarketComparison)
	}
	if result.Status != domain.EstimateStatusDraft {
		t.Fatalf("Status = %q, want %q", result.Status, domain.EstimateStatusDraft)
	}
	if result.YourHourlyRate != 15000 {
		t.Fatalf("YourHourlyRate = %f, want 15000", result.YourHourlyRate)
	}
	if result.Multiplier != 1.8 {
		t.Fatalf("Multiplier = %f, want 1.8", result.Multiplier)
	}

	// Verify event was published
	if len(messagePub.data) == 0 {
		t.Fatal("expected event to be published")
	}
	var event map[string]any
	if err := json.Unmarshal(messagePub.data, &event); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if event["event_type"] != "EstimateRequested" {
		t.Fatalf("event_type = %v, want EstimateRequested", event["event_type"])
	}
}

func TestEstimateServiceCreateHoursOnly(t *testing.T) {
	svc := NewEstimateService(&mockEstimateStore{}, nil)
	tenantID := uuid.New()
	caseID := uuid.New()

	result, err := svc.Create(context.Background(), CreateEstimateInput{
		TenantID:              tenantID,
		CaseID:                caseID,
		YourHourlyRate:        10000,
		IncludeMarketEvidence: false,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if result.EstimateMode != domain.EstimateModeHoursOnly {
		t.Fatalf("EstimateMode = %q, want %q", result.EstimateMode, domain.EstimateModeHoursOnly)
	}
}

func TestEstimateServiceCreateValidation(t *testing.T) {
	svc := NewEstimateService(&mockEstimateStore{}, nil)

	tests := []struct {
		name  string
		input CreateEstimateInput
	}{
		{
			name:  "nil tenant",
			input: CreateEstimateInput{CaseID: uuid.New(), YourHourlyRate: 15000},
		},
		{
			name:  "nil case",
			input: CreateEstimateInput{TenantID: uuid.New(), YourHourlyRate: 15000},
		},
		{
			name:  "zero rate",
			input: CreateEstimateInput{TenantID: uuid.New(), CaseID: uuid.New(), YourHourlyRate: 0},
		},
		{
			name:  "negative rate",
			input: CreateEstimateInput{TenantID: uuid.New(), CaseID: uuid.New(), YourHourlyRate: -1},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.Create(context.Background(), tt.input)
			if err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestEstimateServiceGetByID(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()
	now := time.Now()

	svc := NewEstimateService(&mockEstimateStore{
		getByIDFn: func(_ context.Context, gotTenantID, gotCaseID, gotEstimateID uuid.UUID) (*domain.Estimate, error) {
			if gotTenantID != tenantID || gotCaseID != caseID || gotEstimateID != estimateID {
				t.Fatalf("unexpected IDs")
			}
			return &domain.Estimate{
				ID:        estimateID,
				TenantID:  tenantID,
				CaseID:    caseID,
				CreatedAt: now,
			}, nil
		},
	}, nil)

	record, err := svc.GetByID(context.Background(), tenantID, caseID, estimateID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if record == nil || record.ID != estimateID {
		t.Fatalf("record = %#v, want ID %s", record, estimateID)
	}
}

func TestEstimateServiceListByCaseID(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()

	svc := NewEstimateService(&mockEstimateStore{
		listByCaseFn: func(_ context.Context, gotTenantID, gotCaseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error) {
			if gotTenantID != tenantID || gotCaseID != caseID {
				t.Fatalf("unexpected IDs")
			}
			return []domain.Estimate{{ID: uuid.New()}}, 1, nil
		},
	}, nil)

	records, total, err := svc.ListByCaseID(context.Background(), tenantID, caseID, 20, 0)
	if err != nil {
		t.Fatalf("ListByCaseID() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(records) != 1 {
		t.Fatalf("len(records) = %d, want 1", len(records))
	}
}

func TestEstimateServiceGetThreeWayProposal(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()
	proposalJSON := json.RawMessage(`{"option_a":{"label":"Budget"}}`)

	svc := NewEstimateService(&mockEstimateStore{
		getByIDFn: func(_ context.Context, _, _, _ uuid.UUID) (*domain.Estimate, error) {
			return &domain.Estimate{
				ID:               estimateID,
				ThreeWayProposal: proposalJSON,
			}, nil
		},
	}, nil)

	proposal, err := svc.GetThreeWayProposal(context.Background(), tenantID, caseID, estimateID)
	if err != nil {
		t.Fatalf("GetThreeWayProposal() error = %v", err)
	}
	if string(proposal) != string(proposalJSON) {
		t.Fatalf("proposal = %s, want %s", proposal, proposalJSON)
	}
}

func TestEstimateServiceGetThreeWayProposalNotFound(t *testing.T) {
	svc := NewEstimateService(&mockEstimateStore{}, nil)

	proposal, err := svc.GetThreeWayProposal(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("GetThreeWayProposal() error = %v", err)
	}
	if proposal != nil {
		t.Fatalf("proposal = %s, want nil", proposal)
	}
}

var _ store.EstimateStore = (*mockEstimateStore)(nil)
