package service

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

type mockProposalStore struct {
	createFn                   func(ctx context.Context, tenantID uuid.UUID, proposal *domain.ProposalSession) (*domain.ProposalSession, error)
	listFn                     func(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.ProposalSession, int, error)
	getByIDFn                  func(ctx context.Context, tenantID, proposalID uuid.UUID) (*domain.ProposalSession, error)
	updateStatusIfNotDecidedFn func(ctx context.Context, tenantID, proposalID uuid.UUID, status domain.ProposalStatus, decidedAt *time.Time) error
	createApprovalDecisionFn   func(ctx context.Context, tenantID uuid.UUID, decision *domain.ApprovalDecision) (*domain.ApprovalDecision, error)
	listApprovalDecisionsFn    func(ctx context.Context, tenantID, proposalID uuid.UUID) ([]domain.ApprovalDecision, error)
	getCaseFn                  func(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error)
	getMarketEvidenceFn        func(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error)
	countActiveCasesFn         func(ctx context.Context, tenantID, excludeCaseID uuid.UUID) (int, error)
}

func (m *mockProposalStore) Create(ctx context.Context, tenantID uuid.UUID, proposal *domain.ProposalSession) (*domain.ProposalSession, error) {
	if m.createFn != nil {
		return m.createFn(ctx, tenantID, proposal)
	}
	now := time.Now().UTC()
	proposal.CreatedAt = now
	proposal.UpdatedAt = now
	return proposal, nil
}

func (m *mockProposalStore) List(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.ProposalSession, int, error) {
	if m.listFn != nil {
		return m.listFn(ctx, tenantID, caseID, limit, offset)
	}
	return nil, 0, nil
}

func (m *mockProposalStore) GetByID(ctx context.Context, tenantID, proposalID uuid.UUID) (*domain.ProposalSession, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, tenantID, proposalID)
	}
	return nil, nil
}

func (m *mockProposalStore) UpdateStatusIfNotDecided(ctx context.Context, tenantID, proposalID uuid.UUID, status domain.ProposalStatus, decidedAt *time.Time) error {
	if m.updateStatusIfNotDecidedFn != nil {
		return m.updateStatusIfNotDecidedFn(ctx, tenantID, proposalID, status, decidedAt)
	}
	return nil
}

func (m *mockProposalStore) CreateApprovalDecision(ctx context.Context, tenantID uuid.UUID, decision *domain.ApprovalDecision) (*domain.ApprovalDecision, error) {
	if m.createApprovalDecisionFn != nil {
		return m.createApprovalDecisionFn(ctx, tenantID, decision)
	}
	decision.CreatedAt = decision.DecidedAt
	return decision, nil
}

func (m *mockProposalStore) ListApprovalDecisions(ctx context.Context, tenantID, proposalID uuid.UUID) ([]domain.ApprovalDecision, error) {
	if m.listApprovalDecisionsFn != nil {
		return m.listApprovalDecisionsFn(ctx, tenantID, proposalID)
	}
	return nil, nil
}

func (m *mockProposalStore) GetCase(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error) {
	if m.getCaseFn != nil {
		return m.getCaseFn(ctx, tenantID, caseID)
	}
	return nil, nil
}

func (m *mockProposalStore) GetMarketEvidence(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error) {
	if m.getMarketEvidenceFn != nil {
		return m.getMarketEvidenceFn(ctx, tenantID, evidenceID)
	}
	return nil, nil
}

func (m *mockProposalStore) CountActiveCases(ctx context.Context, tenantID, excludeCaseID uuid.UUID) (int, error) {
	if m.countActiveCasesFn != nil {
		return m.countActiveCasesFn(ctx, tenantID, excludeCaseID)
	}
	return 0, nil
}

type mockEstimateStoreForProposal struct {
	getByIDFn    func(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error)
	listByCaseFn func(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error)
}

func (m *mockEstimateStoreForProposal) Create(context.Context, *domain.Estimate) (*domain.Estimate, error) {
	return nil, errors.New("unexpected Create call")
}

func (m *mockEstimateStoreForProposal) GetByID(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, tenantID, caseID, estimateID)
	}
	return nil, nil
}

func (m *mockEstimateStoreForProposal) ListByCaseID(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error) {
	if m.listByCaseFn != nil {
		return m.listByCaseFn(ctx, tenantID, caseID, limit, offset)
	}
	return nil, 0, nil
}

func (m *mockEstimateStoreForProposal) UpdateThreeWayProposal(context.Context, uuid.UUID, uuid.UUID, json.RawMessage) error {
	return errors.New("unexpected UpdateThreeWayProposal call")
}

func TestProposalServiceCreateProposal(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()

	tests := []struct {
		name      string
		store     *mockProposalStore
		estimates *mockEstimateStoreForProposal
		wantErr   error
	}{
		{
			name:  "success",
			store: &mockProposalStore{},
			estimates: &mockEstimateStoreForProposal{
				getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
					return &domain.Estimate{ID: estimateID}, nil
				},
			},
		},
		{
			name:  "estimate not found",
			store: &mockProposalStore{},
			estimates: &mockEstimateStoreForProposal{
				getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
					return nil, nil
				},
			},
			wantErr: ErrNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewProposalService(tt.store, tt.estimates)
			got, err := svc.CreateProposal(context.Background(), tenantID, caseID, estimateID)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("CreateProposal() error = %v, want %v", err, tt.wantErr)
			}
			if err == nil {
				if got == nil {
					t.Fatal("CreateProposal() returned nil")
				}
				if got.Status != domain.ProposalStatusDraft {
					t.Fatalf("CreateProposal() status = %q, want %q", got.Status, domain.ProposalStatusDraft)
				}
			}
		})
	}
}

func TestProposalServiceDecideProposal(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	otherCaseID := uuid.New()
	proposalID := uuid.New()

	tests := []struct {
		name     string
		run      func(*ProposalService) (*domain.ApprovalDecision, error)
		store    *mockProposalStore
		wantErr  error
		wantType domain.Decision
		wantUID  string
	}{
		{
			name: "approve success",
			store: &mockProposalStore{
				getByIDFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.ProposalSession, error) {
					return &domain.ProposalSession{ID: proposalID, CaseID: caseID, Status: domain.ProposalStatusDraft}, nil
				},
			},
			run: func(svc *ProposalService) (*domain.ApprovalDecision, error) {
				return svc.ApproveProposal(context.Background(), tenantID, caseID, proposalID, "", "", "approved")
			},
			wantType: domain.DecisionApproved,
			wantUID:  systemDecisionUID,
		},
		{
			name: "reject requires reason",
			store: &mockProposalStore{
				getByIDFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.ProposalSession, error) {
					return &domain.ProposalSession{ID: proposalID, CaseID: caseID, Status: domain.ProposalStatusDraft}, nil
				},
			},
			run: func(svc *ProposalService) (*domain.ApprovalDecision, error) {
				return svc.RejectProposal(context.Background(), tenantID, caseID, proposalID, "uid-1", "", "")
			},
			wantErr: ErrReasonRequired,
		},
		{
			name: "already decided",
			store: &mockProposalStore{
				getByIDFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.ProposalSession, error) {
					return &domain.ProposalSession{ID: proposalID, CaseID: caseID, Status: domain.ProposalStatusDraft}, nil
				},
				updateStatusIfNotDecidedFn: func(context.Context, uuid.UUID, uuid.UUID, domain.ProposalStatus, *time.Time) error {
					return store.ErrAlreadyDecided
				},
			},
			run: func(svc *ProposalService) (*domain.ApprovalDecision, error) {
				return svc.ApproveProposal(context.Background(), tenantID, caseID, proposalID, "uid-1", "", "approved")
			},
			wantErr: ErrAlreadyDecided,
		},
		{
			name: "case mismatch returns not found",
			store: &mockProposalStore{
				getByIDFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.ProposalSession, error) {
					return &domain.ProposalSession{ID: proposalID, CaseID: otherCaseID, Status: domain.ProposalStatusDraft}, nil
				},
			},
			run: func(svc *ProposalService) (*domain.ApprovalDecision, error) {
				return svc.ApproveProposal(context.Background(), tenantID, caseID, proposalID, "uid-1", "", "approved")
			},
			wantErr: ErrNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewProposalService(tt.store, &mockEstimateStoreForProposal{})
			got, err := tt.run(svc)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("decision call error = %v, want %v", err, tt.wantErr)
			}
			if err == nil {
				if got.Decision != tt.wantType {
					t.Fatalf("decision type = %q, want %q", got.Decision, tt.wantType)
				}
				if got.DecidedByUID != tt.wantUID {
					t.Fatalf("decided_by_uid = %q, want %q", got.DecidedByUID, tt.wantUID)
				}
			}
		})
	}
}

func TestProposalServiceEvaluateGoNoGo(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	evidenceID := uuid.New()
	calibration := 1.12

	tests := []struct {
		name         string
		caseType     domain.CaseType
		estimate     domain.Estimate
		evidence     *domain.AggregatedEvidence
		activeCases  int
		wantDecision domain.GoNoGoDecision
		wantWeight   float64
		wantAxis     string
	}{
		{
			name:     "high confidence go",
			caseType: domain.CaseTypeNewProject,
			estimate: domain.Estimate{
				ID:                   uuid.New(),
				TotalYourCost:        800000,
				TotalMarketCost:      floatPtr(1000000),
				AggregatedEvidenceID: &evidenceID,
				CalibrationRatio:     &calibration,
			},
			evidence:     &domain.AggregatedEvidence{OverallConfidence: "high"},
			activeCases:  1,
			wantDecision: domain.GoNoGoDecisionGo,
			wantAxis:     goNoGoAxisProfitability,
			wantWeight:   0.35,
		},
		{
			name:     "medium confidence go with conditions",
			caseType: domain.CaseTypeNewProject,
			estimate: domain.Estimate{
				ID:                   uuid.New(),
				TotalYourCost:        800000,
				TotalMarketCost:      floatPtr(1000000),
				AggregatedEvidenceID: &evidenceID,
			},
			evidence:     &domain.AggregatedEvidence{OverallConfidence: "medium"},
			activeCases:  1,
			wantDecision: domain.GoNoGoDecisionGoWithConditions,
			wantAxis:     goNoGoAxisProfitability,
			wantWeight:   0.35,
		},
		{
			name:     "low confidence no go",
			caseType: domain.CaseTypeNewProject,
			estimate: domain.Estimate{
				ID:                   uuid.New(),
				TotalYourCost:        800000,
				TotalMarketCost:      floatPtr(1000000),
				AggregatedEvidenceID: &evidenceID,
			},
			evidence:     &domain.AggregatedEvidence{OverallConfidence: "low"},
			activeCases:  1,
			wantDecision: domain.GoNoGoDecisionNoGo,
			wantAxis:     goNoGoAxisProfitability,
			wantWeight:   0.35,
		},
		{
			name:     "contradictions force no go even with high confidence",
			caseType: domain.CaseTypeNewProject,
			estimate: domain.Estimate{
				ID:                   uuid.New(),
				TotalYourCost:        800000,
				TotalMarketCost:      floatPtr(1000000),
				AggregatedEvidenceID: &evidenceID,
			},
			evidence: &domain.AggregatedEvidence{
				OverallConfidence: "high",
				Contradictions: []domain.Contradiction{{
					ProviderA:   "provider-a",
					ProviderB:   "provider-b",
					Field:       "pricing",
					Description: "pricing mismatch",
				}},
			},
			activeCases:  1,
			wantDecision: domain.GoNoGoDecisionNoGo,
			wantAxis:     goNoGoAxisProfitability,
			wantWeight:   0.35,
		},
		{
			name:     "high confidence over budget is go with conditions",
			caseType: domain.CaseTypeNewProject,
			estimate: domain.Estimate{
				ID:                   uuid.New(),
				TotalYourCost:        1200000,
				TotalMarketCost:      floatPtr(1000000),
				AggregatedEvidenceID: &evidenceID,
			},
			evidence:     &domain.AggregatedEvidence{OverallConfidence: "high"},
			activeCases:  1,
			wantDecision: domain.GoNoGoDecisionGoWithConditions,
			wantAxis:     goNoGoAxisProfitability,
			wantWeight:   0.35,
		},
		{
			name:     "bug fix redistributes profitability weight",
			caseType: domain.CaseTypeFixRequest,
			estimate: domain.Estimate{
				ID:                   uuid.New(),
				TotalYourCost:        0,
				TotalMarketCost:      floatPtr(1000000),
				AggregatedEvidenceID: &evidenceID,
				ThreeWayProposal:     json.RawMessage(`{"our_proposal":{"savings_vs_market_percent":0}}`),
			},
			evidence:     &domain.AggregatedEvidence{OverallConfidence: "high"},
			activeCases:  0,
			wantDecision: domain.GoNoGoDecisionGo,
			wantAxis:     goNoGoAxisProfitability,
			wantWeight:   0,
		},
		{
			name:     "bug report over budget still gets go (budget exempt)",
			caseType: domain.CaseTypeBugReport,
			estimate: domain.Estimate{
				ID:                   uuid.New(),
				TotalYourCost:        1500000,
				TotalMarketCost:      floatPtr(1000000),
				AggregatedEvidenceID: &evidenceID,
			},
			evidence:     &domain.AggregatedEvidence{OverallConfidence: "high"},
			activeCases:  1,
			wantDecision: domain.GoNoGoDecisionGo,
			wantAxis:     goNoGoAxisProfitability,
			wantWeight:   0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewProposalService(&mockProposalStore{
				getCaseFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.Case, error) {
					return &domain.Case{ID: caseID, Type: tt.caseType}, nil
				},
				getMarketEvidenceFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.AggregatedEvidence, error) {
					return tt.evidence, nil
				},
				countActiveCasesFn: func(context.Context, uuid.UUID, uuid.UUID) (int, error) {
					return tt.activeCases, nil
				},
			}, &mockEstimateStoreForProposal{
				listByCaseFn: func(context.Context, uuid.UUID, uuid.UUID, int, int) ([]domain.Estimate, int, error) {
					return []domain.Estimate{tt.estimate}, 1, nil
				},
			})

			got, err := svc.EvaluateGoNoGo(context.Background(), tenantID, caseID)
			if err != nil {
				t.Fatalf("EvaluateGoNoGo() error = %v", err)
			}
			if got.Decision != tt.wantDecision {
				t.Fatalf("EvaluateGoNoGo() decision = %q, want %q", got.Decision, tt.wantDecision)
			}
			if !almostEqual(got.Weights[tt.wantAxis], tt.wantWeight) {
				t.Fatalf("EvaluateGoNoGo() weight[%s] = %f, want %f", tt.wantAxis, got.Weights[tt.wantAxis], tt.wantWeight)
			}
			if tt.caseType == domain.CaseTypeFixRequest {
				if !almostEqual(got.Weights[goNoGoAxisStrategicAlignment], 0.25/0.65) {
					t.Fatalf("strategic_alignment weight = %f, want %f", got.Weights[goNoGoAxisStrategicAlignment], 0.25/0.65)
				}
			}
		})
	}
}

func TestProposalServiceEvaluateGoNoGoInvalidThreeWayProposal(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()

	svc := NewProposalService(&mockProposalStore{
		getCaseFn: func(context.Context, uuid.UUID, uuid.UUID) (*domain.Case, error) {
			return &domain.Case{ID: caseID, Type: domain.CaseTypeNewProject}, nil
		},
	}, &mockEstimateStoreForProposal{
		listByCaseFn: func(context.Context, uuid.UUID, uuid.UUID, int, int) ([]domain.Estimate, int, error) {
			return []domain.Estimate{{
				ID:               uuid.New(),
				ThreeWayProposal: json.RawMessage(`{"market_benchmark":`),
			}}, 1, nil
		},
	})

	_, err := svc.EvaluateGoNoGo(context.Background(), tenantID, caseID)
	if err == nil {
		t.Fatal("EvaluateGoNoGo() error = nil, want decode error")
	}
}

func floatPtr(v float64) *float64 {
	return &v
}

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < 0.0001
}

var _ store.ProposalStore = (*mockProposalStore)(nil)
var _ store.EstimateStore = (*mockEstimateStoreForProposal)(nil)
