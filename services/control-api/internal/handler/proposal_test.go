package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

type fakeProposalStore struct {
	createFn                   func(ctx context.Context, tenantID uuid.UUID, proposal *domain.ProposalSession) (*domain.ProposalSession, error)
	listFn                     func(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.ProposalSession, int, error)
	getByIDFn                  func(ctx context.Context, tenantID, proposalID uuid.UUID) (*domain.ProposalSession, error)
	updateStatusIfNotDecidedFn func(ctx context.Context, tenantID, proposalID uuid.UUID, status domain.ProposalStatus, decidedAt *time.Time) error
	createApprovalDecisionFn   func(ctx context.Context, tenantID uuid.UUID, decision *domain.ApprovalDecision) (*domain.ApprovalDecision, error)
	getCaseFn                  func(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error)
	getMarketEvidenceFn        func(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error)
	countActiveCasesFn         func(ctx context.Context, tenantID, excludeCaseID uuid.UUID) (int, error)
}

func (f *fakeProposalStore) Create(ctx context.Context, tenantID uuid.UUID, proposal *domain.ProposalSession) (*domain.ProposalSession, error) {
	if f.createFn != nil {
		return f.createFn(ctx, tenantID, proposal)
	}
	now := time.Now().UTC()
	proposal.CreatedAt = now
	proposal.UpdatedAt = now
	return proposal, nil
}

func (f *fakeProposalStore) List(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.ProposalSession, int, error) {
	if f.listFn != nil {
		return f.listFn(ctx, tenantID, caseID, limit, offset)
	}
	return nil, 0, nil
}

func (f *fakeProposalStore) GetByID(ctx context.Context, tenantID, proposalID uuid.UUID) (*domain.ProposalSession, error) {
	if f.getByIDFn != nil {
		return f.getByIDFn(ctx, tenantID, proposalID)
	}
	return nil, nil
}

func (f *fakeProposalStore) UpdateStatusIfNotDecided(ctx context.Context, tenantID, proposalID uuid.UUID, status domain.ProposalStatus, decidedAt *time.Time) error {
	if f.updateStatusIfNotDecidedFn != nil {
		return f.updateStatusIfNotDecidedFn(ctx, tenantID, proposalID, status, decidedAt)
	}
	return nil
}

func (f *fakeProposalStore) CreateApprovalDecision(ctx context.Context, tenantID uuid.UUID, decision *domain.ApprovalDecision) (*domain.ApprovalDecision, error) {
	if f.createApprovalDecisionFn != nil {
		return f.createApprovalDecisionFn(ctx, tenantID, decision)
	}
	decision.CreatedAt = decision.DecidedAt
	return decision, nil
}

func (f *fakeProposalStore) ListApprovalDecisions(context.Context, uuid.UUID, uuid.UUID) ([]domain.ApprovalDecision, error) {
	return nil, nil
}

func (f *fakeProposalStore) GetCase(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error) {
	if f.getCaseFn != nil {
		return f.getCaseFn(ctx, tenantID, caseID)
	}
	return nil, nil
}

func (f *fakeProposalStore) GetMarketEvidence(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error) {
	if f.getMarketEvidenceFn != nil {
		return f.getMarketEvidenceFn(ctx, tenantID, evidenceID)
	}
	return nil, nil
}

func (f *fakeProposalStore) CountActiveCases(ctx context.Context, tenantID, excludeCaseID uuid.UUID) (int, error) {
	if f.countActiveCasesFn != nil {
		return f.countActiveCasesFn(ctx, tenantID, excludeCaseID)
	}
	return 0, nil
}

type fakeEstimateStoreForProposalHandler struct {
	getByIDFn    func(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error)
	listByCaseFn func(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error)
}

func (f *fakeEstimateStoreForProposalHandler) Create(context.Context, *domain.Estimate) (*domain.Estimate, error) {
	return nil, nil
}

func (f *fakeEstimateStoreForProposalHandler) GetByID(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error) {
	if f.getByIDFn != nil {
		return f.getByIDFn(ctx, tenantID, caseID, estimateID)
	}
	return nil, nil
}

func (f *fakeEstimateStoreForProposalHandler) ListByCaseID(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error) {
	if f.listByCaseFn != nil {
		return f.listByCaseFn(ctx, tenantID, caseID, limit, offset)
	}
	return nil, 0, nil
}

func (f *fakeEstimateStoreForProposalHandler) UpdateThreeWayProposal(context.Context, uuid.UUID, uuid.UUID, json.RawMessage) error {
	return nil
}

func TestProposalHandlerCreate(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	estimateID := uuid.New()

	svc := service.NewProposalService(&fakeProposalStore{}, &fakeEstimateStoreForProposalHandler{
		getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
			return &domain.Estimate{ID: estimateID}, nil
		},
	})
	handler := NewProposalHandler(svc)

	mux := http.NewServeMux()
	RegisterProposalRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/proposals", bytes.NewBufferString(`{"estimate_id":"`+estimateID.String()+`"}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
}

func TestProposalHandlerList(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	proposalID := uuid.New()

	svc := service.NewProposalService(&fakeProposalStore{
		listFn: func(context.Context, uuid.UUID, uuid.UUID, int, int) ([]domain.ProposalSession, int, error) {
			return []domain.ProposalSession{{ID: proposalID, Status: domain.ProposalStatusDraft}}, 1, nil
		},
	}, &fakeEstimateStoreForProposalHandler{})
	handler := NewProposalHandler(svc)

	mux := http.NewServeMux()
	RegisterProposalRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/proposals?limit=10&offset=0", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestProposalHandlerApproveReject(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	proposalID := uuid.New()

	tests := []struct {
		name         string
		path         string
		body         string
		wantDecision string
	}{
		{
			name:         "approve",
			path:         "/v1/cases/" + caseID.String() + "/proposals/" + proposalID.String() + "/approve",
			body:         `{"comment":"approved"}`,
			wantDecision: string(domain.DecisionApproved),
		},
		{
			name:         "reject",
			path:         "/v1/cases/" + caseID.String() + "/proposals/" + proposalID.String() + "/reject",
			body:         `{"reason":"missing details"}`,
			wantDecision: string(domain.DecisionRejected),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := service.NewProposalService(&fakeProposalStore{
				getByIDFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.ProposalSession, error) {
					return &domain.ProposalSession{ID: proposalID, CaseID: caseID, Status: domain.ProposalStatusDraft}, nil
				},
			}, &fakeEstimateStoreForProposalHandler{})
			handler := NewProposalHandler(svc)

			mux := http.NewServeMux()
			RegisterProposalRoutes(mux, handler)

			req := httptest.NewRequest(http.MethodPost, tt.path, bytes.NewBufferString(tt.body))
			req.Header.Set("X-Tenant-ID", tenantID.String())
			rec := httptest.NewRecorder()

			middleware.Tenant(mux).ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
			}

			var body map[string]map[string]any
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("Decode() error = %v", err)
			}
			if body["data"]["decision"] != tt.wantDecision {
				t.Fatalf("decision = %v, want %q", body["data"]["decision"], tt.wantDecision)
			}
		})
	}
}

func TestProposalHandlerApproveCaseOwnershipMismatch(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	proposalID := uuid.New()

	svc := service.NewProposalService(&fakeProposalStore{
		getByIDFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.ProposalSession, error) {
			return &domain.ProposalSession{ID: proposalID, CaseID: uuid.New(), Status: domain.ProposalStatusDraft}, nil
		},
	}, &fakeEstimateStoreForProposalHandler{})
	handler := NewProposalHandler(svc)

	mux := http.NewServeMux()
	RegisterProposalRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/proposals/"+proposalID.String()+"/approve", bytes.NewBufferString(`{"comment":"approved"}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestProposalHandlerEvaluateGoNoGo(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	evidenceID := uuid.New()

	svc := service.NewProposalService(&fakeProposalStore{
		getCaseFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.Case, error) {
			return &domain.Case{ID: caseID, Type: domain.CaseTypeNewProject}, nil
		},
		getMarketEvidenceFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.AggregatedEvidence, error) {
			return &domain.AggregatedEvidence{OverallConfidence: "high"}, nil
		},
	}, &fakeEstimateStoreForProposalHandler{
		listByCaseFn: func(context.Context, uuid.UUID, uuid.UUID, int, int) ([]domain.Estimate, int, error) {
			return []domain.Estimate{{
				ID:                   uuid.New(),
				TotalYourCost:        800000,
				TotalMarketCost:      floatPtr(1000000),
				AggregatedEvidenceID: &evidenceID,
			}}, 1, nil
		},
	})
	handler := NewProposalHandler(svc)

	mux := http.NewServeMux()
	RegisterProposalRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/go-no-go", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func floatPtr(v float64) *float64 {
	return &v
}
