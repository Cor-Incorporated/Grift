package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

const (
	goNoGoAxisProfitability      = "profitability"
	goNoGoAxisStrategicAlignment = "strategic_alignment"
	goNoGoAxisCapacity           = "capacity"
	goNoGoAxisTechnicalRisk      = "technical_risk"
	systemDecisionUID            = "system"
)

var defaultGoNoGoWeights = map[string]float64{
	goNoGoAxisProfitability:      0.35,
	goNoGoAxisStrategicAlignment: 0.25,
	goNoGoAxisCapacity:           0.20,
	goNoGoAxisTechnicalRisk:      0.20,
}

var (
	ErrAlreadyDecided = errors.New("proposal already decided")
	ErrReasonRequired = errors.New("reason is required for rejection")
)

// ProposalService handles proposal CRUD and go/no-go evaluation.
type ProposalService struct {
	store         store.ProposalStore
	estimateStore store.EstimateStore
}

// NewProposalService constructs a ProposalService.
func NewProposalService(s store.ProposalStore, estimateStore store.EstimateStore) *ProposalService {
	return &ProposalService{store: s, estimateStore: estimateStore}
}

// CreateProposal validates the request and creates a draft proposal session.
func (s *ProposalService) CreateProposal(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.ProposalSession, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if caseID == uuid.Nil {
		return nil, fmt.Errorf("case_id is required")
	}
	if estimateID == uuid.Nil {
		return nil, fmt.Errorf("estimate_id is required")
	}

	estimate, err := s.estimateStore.GetByID(ctx, tenantID, caseID, estimateID)
	if err != nil {
		return nil, fmt.Errorf("get estimate for proposal: %w", err)
	}
	if estimate == nil {
		return nil, ErrNotFound
	}

	proposal := &domain.ProposalSession{
		ID:         uuid.New(),
		TenantID:   tenantID,
		CaseID:     caseID,
		EstimateID: estimateID,
		Status:     domain.ProposalStatusDraft,
	}

	created, err := s.store.Create(ctx, tenantID, proposal)
	if err != nil {
		return nil, fmt.Errorf("create proposal: %w", err)
	}
	return created, nil
}

// ListProposals returns proposal sessions for the specified case.
func (s *ProposalService) ListProposals(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.ProposalSession, int, error) {
	records, total, err := s.store.List(ctx, tenantID, caseID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list proposals: %w", err)
	}
	return records, total, nil
}

// ApproveProposal records an approval decision and updates the proposal status.
func (s *ProposalService) ApproveProposal(ctx context.Context, tenantID, caseID, proposalID uuid.UUID, uid, role, comment string) (*domain.ApprovalDecision, error) {
	return s.decideProposal(ctx, tenantID, caseID, proposalID, uid, role, comment, domain.DecisionApproved, domain.ProposalStatusApproved)
}

// RejectProposal records a rejection decision and updates the proposal status.
func (s *ProposalService) RejectProposal(ctx context.Context, tenantID, caseID, proposalID uuid.UUID, uid, role, comment string) (*domain.ApprovalDecision, error) {
	if strings.TrimSpace(comment) == "" {
		return nil, ErrReasonRequired
	}
	return s.decideProposal(ctx, tenantID, caseID, proposalID, uid, role, comment, domain.DecisionRejected, domain.ProposalStatusRejected)
}

// EvaluateGoNoGo computes the case-level go/no-go result using the latest estimate.
func (s *ProposalService) EvaluateGoNoGo(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.GoNoGoResult, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if caseID == uuid.Nil {
		return nil, fmt.Errorf("case_id is required")
	}

	caseRecord, err := s.store.GetCase(ctx, tenantID, caseID)
	if err != nil {
		return nil, fmt.Errorf("get case for go/no-go: %w", err)
	}
	if caseRecord == nil {
		return nil, ErrNotFound
	}

	estimates, _, err := s.estimateStore.ListByCaseID(ctx, tenantID, caseID, 1, 0)
	if err != nil {
		return nil, fmt.Errorf("list estimates for go/no-go: %w", err)
	}
	if len(estimates) == 0 {
		return nil, ErrNotFound
	}
	estimate := estimates[0]

	proposalData, err := decodeThreeWayProposal(estimate.ThreeWayProposal)
	if err != nil {
		return nil, err
	}

	var evidence *domain.AggregatedEvidence
	if estimate.AggregatedEvidenceID != nil {
		evidence, err = s.store.GetMarketEvidence(ctx, tenantID, *estimate.AggregatedEvidenceID)
		if err != nil {
			return nil, fmt.Errorf("get market evidence for go/no-go: %w", err)
		}
	}

	activeCases, err := s.store.CountActiveCases(ctx, tenantID, caseID)
	if err != nil {
		return nil, fmt.Errorf("count active cases for go/no-go: %w", err)
	}

	confidence := confidenceLevel(evidence, proposalData)
	contradictions := contradictionCount(evidence, proposalData)
	withinBudget, budgetBasis := withinBudget(estimate, proposalData)

	scores := map[string]float64{
		goNoGoAxisProfitability:      scoreProfitability(caseRecord.Type, estimate, proposalData, withinBudget),
		goNoGoAxisStrategicAlignment: scoreStrategicAlignment(caseRecord.Type),
		goNoGoAxisCapacity:           scoreCapacity(activeCases),
		goNoGoAxisTechnicalRisk:      scoreTechnicalRisk(confidence, contradictions, estimate.RiskFlags),
	}
	weights := goNoGoWeights(caseRecord.Type)

	// Bug/fix cases skip the budget gate — profitability weight is already 0.
	budgetExempt := caseRecord.Type == domain.CaseTypeBugReport || caseRecord.Type == domain.CaseTypeFixRequest

	decision := domain.GoNoGoDecisionNoGo
	switch {
	case contradictions > 0 || confidence == "low":
		decision = domain.GoNoGoDecisionNoGo
	case confidence == "high" && (withinBudget || budgetExempt):
		decision = domain.GoNoGoDecisionGo
	case confidence == "medium", confidence == "high" && !withinBudget:
		decision = domain.GoNoGoDecisionGoWithConditions
	}

	reasoning := buildGoNoGoReasoning(decision, confidence, withinBudget, budgetBasis, contradictions, scores, weights, activeCases)

	return &domain.GoNoGoResult{
		Decision:           decision,
		Scores:             scores,
		Weights:            weights,
		Reasoning:          reasoning,
		BigQueryAdjustment: estimate.CalibrationRatio,
	}, nil
}

func (s *ProposalService) decideProposal(
	ctx context.Context,
	tenantID, caseID, proposalID uuid.UUID,
	uid, role, comment string,
	decisionType domain.Decision,
	status domain.ProposalStatus,
) (*domain.ApprovalDecision, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if caseID == uuid.Nil {
		return nil, fmt.Errorf("case_id is required")
	}
	if proposalID == uuid.Nil {
		return nil, fmt.Errorf("proposal_id is required")
	}

	proposal, err := s.store.GetByID(ctx, tenantID, proposalID)
	if err != nil {
		return nil, fmt.Errorf("get proposal: %w", err)
	}
	if proposal == nil {
		return nil, ErrNotFound
	}
	if proposal.CaseID != caseID {
		return nil, ErrNotFound
	}

	decidedAt := time.Now().UTC()
	if err := s.store.UpdateStatusIfNotDecided(ctx, tenantID, proposalID, status, &decidedAt); err != nil {
		if errors.Is(err, store.ErrAlreadyDecided) {
			return nil, ErrAlreadyDecided
		}
		if errors.Is(err, store.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("update proposal status: %w", err)
	}

	decision := &domain.ApprovalDecision{
		ID:            uuid.New(),
		TenantID:      tenantID,
		ProposalID:    proposalID,
		Decision:      decisionType,
		DecidedByUID:  decisionUID(uid),
		DecidedByRole: optionalString(role),
		Comment:       optionalString(comment),
		DecidedAt:     decidedAt,
	}

	created, err := s.store.CreateApprovalDecision(ctx, tenantID, decision)
	if err != nil {
		return nil, fmt.Errorf("create approval decision: %w", err)
	}
	return created, nil
}

func decisionUID(uid string) string {
	trimmed := strings.TrimSpace(uid)
	if trimmed == "" {
		return systemDecisionUID
	}
	return trimmed
}

func optionalString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func goNoGoWeights(caseType domain.CaseType) map[string]float64 {
	weights := map[string]float64{
		goNoGoAxisProfitability:      defaultGoNoGoWeights[goNoGoAxisProfitability],
		goNoGoAxisStrategicAlignment: defaultGoNoGoWeights[goNoGoAxisStrategicAlignment],
		goNoGoAxisCapacity:           defaultGoNoGoWeights[goNoGoAxisCapacity],
		goNoGoAxisTechnicalRisk:      defaultGoNoGoWeights[goNoGoAxisTechnicalRisk],
	}

	if caseType != domain.CaseTypeBugReport && caseType != domain.CaseTypeFixRequest {
		return weights
	}

	profitabilityWeight := weights[goNoGoAxisProfitability]
	weights[goNoGoAxisProfitability] = 0

	remaining := 1.0 - profitabilityWeight
	weights[goNoGoAxisStrategicAlignment] = weights[goNoGoAxisStrategicAlignment] / remaining
	weights[goNoGoAxisCapacity] = weights[goNoGoAxisCapacity] / remaining
	weights[goNoGoAxisTechnicalRisk] = weights[goNoGoAxisTechnicalRisk] / remaining
	return weights
}

func scoreProfitability(caseType domain.CaseType, estimate domain.Estimate, proposalData proposalPayload, withinBudget bool) float64 {
	if caseType == domain.CaseTypeBugReport || caseType == domain.CaseTypeFixRequest {
		return 100
	}

	if withinBudget {
		if estimate.TotalMarketCost != nil && *estimate.TotalMarketCost > 0 {
			savingsRatio := 1 - (estimate.TotalYourCost / *estimate.TotalMarketCost)
			score := 70 + savingsRatio*30
			if score > 100 {
				return 100
			}
			if score < 0 {
				return 0
			}
			return score
		}
		return 75
	}

	if proposalData.OurProposal.SavingsVsMarketPercent != nil {
		if *proposalData.OurProposal.SavingsVsMarketPercent >= -10 {
			return 50
		}
		return 25
	}
	if estimate.TotalMarketCost != nil && *estimate.TotalMarketCost > 0 {
		overrunRatio := (estimate.TotalYourCost / *estimate.TotalMarketCost) - 1
		if overrunRatio <= 0.1 {
			return 50
		}
		return 20
	}
	return 40
}

func scoreStrategicAlignment(caseType domain.CaseType) float64 {
	switch caseType {
	case domain.CaseTypeNewProject:
		return 85
	case domain.CaseTypeFeatureAddition:
		return 75
	case domain.CaseTypeFixRequest, domain.CaseTypeBugReport:
		return 70
	default:
		return 50
	}
}

func scoreCapacity(activeCases int) float64 {
	switch {
	case activeCases <= 2:
		return 100
	case activeCases <= 4:
		return float64(100 - (activeCases-2)*25)
	default:
		score := 100 - (activeCases * 15)
		if score < 10 {
			return 10
		}
		return float64(score)
	}
}

func scoreTechnicalRisk(confidence string, contradictions int, riskFlags []string) float64 {
	riskPoints := len(riskFlags) * 15
	riskPoints += contradictions * 20

	switch confidence {
	case "medium":
		riskPoints += 20
	case "low":
		riskPoints += 40
	}

	score := 100 - riskPoints
	if score < 0 {
		return 0
	}
	return float64(score)
}

func buildGoNoGoReasoning(
	decision domain.GoNoGoDecision,
	confidence string,
	withinBudget bool,
	budgetBasis string,
	contradictions int,
	scores map[string]float64,
	weights map[string]float64,
	activeCases int,
) string {
	weightedScore := 0.0
	for axis, score := range scores {
		weightedScore += score * weights[axis]
	}

	lines := []string{
		fmt.Sprintf("decision=%s", decision),
		fmt.Sprintf("confidence=%s", confidence),
		fmt.Sprintf("within_budget=%t (%s)", withinBudget, budgetBasis),
		fmt.Sprintf("contradictions=%d", contradictions),
		fmt.Sprintf("active_cases=%d", activeCases),
		fmt.Sprintf("weighted_score=%.1f", weightedScore),
		fmt.Sprintf("%s=%.1f", goNoGoAxisProfitability, scores[goNoGoAxisProfitability]),
		fmt.Sprintf("%s=%.1f", goNoGoAxisStrategicAlignment, scores[goNoGoAxisStrategicAlignment]),
		fmt.Sprintf("%s=%.1f", goNoGoAxisCapacity, scores[goNoGoAxisCapacity]),
		fmt.Sprintf("%s=%.1f", goNoGoAxisTechnicalRisk, scores[goNoGoAxisTechnicalRisk]),
	}
	return strings.Join(lines, "\n")
}

func confidenceLevel(evidence *domain.AggregatedEvidence, proposalData proposalPayload) string {
	if evidence != nil {
		switch evidence.OverallConfidence {
		case "high", "medium", "low":
			return evidence.OverallConfidence
		}
	}
	if proposalData.MarketBenchmark.Confidence != "" {
		return proposalData.MarketBenchmark.Confidence
	}
	return "low"
}

func contradictionCount(evidence *domain.AggregatedEvidence, proposalData proposalPayload) int {
	if evidence != nil && len(evidence.Contradictions) > 0 {
		return len(evidence.Contradictions)
	}
	return len(proposalData.MarketBenchmark.Contradictions)
}

func withinBudget(estimate domain.Estimate, proposalData proposalPayload) (bool, string) {
	if estimate.TotalMarketCost != nil && *estimate.TotalMarketCost > 0 {
		return estimate.TotalYourCost <= *estimate.TotalMarketCost, "estimated total vs market total"
	}
	if proposalData.OurProposal.SavingsVsMarketPercent != nil {
		return *proposalData.OurProposal.SavingsVsMarketPercent >= 0, "three_way_proposal savings_vs_market_percent"
	}
	return false, "budget proxy unavailable"
}

type proposalPayload struct {
	MarketBenchmark struct {
		Confidence     string                 `json:"confidence"`
		Contradictions []domain.Contradiction `json:"contradictions"`
	} `json:"market_benchmark"`
	OurProposal struct {
		SavingsVsMarketPercent *float64 `json:"savings_vs_market_percent"`
	} `json:"our_proposal"`
}

func decodeThreeWayProposal(raw json.RawMessage) (proposalPayload, error) {
	var payload proposalPayload
	if len(raw) == 0 {
		return payload, nil
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return payload, fmt.Errorf("decode three_way_proposal: %w", err)
	}
	return payload, nil
}
