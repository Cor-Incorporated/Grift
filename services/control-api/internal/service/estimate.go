package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/estimateevent"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

// ErrEstimatePublisherUnavailable indicates the estimate publisher is not configured.
var ErrEstimatePublisherUnavailable = fmt.Errorf("estimate publisher unavailable")

// EstimateService handles creation and retrieval of estimates.
type EstimateService struct {
	store     store.EstimateStore
	publisher *estimateevent.Publisher
}

// CreateEstimateInput is the input contract for creating an estimate.
type CreateEstimateInput struct {
	TenantID             uuid.UUID
	CaseID               uuid.UUID
	YourHourlyRate       float64
	Region               string
	IncludeMarketEvidence bool
}

// NewEstimateService constructs an EstimateService.
func NewEstimateService(s store.EstimateStore, publisher *estimateevent.Publisher) *EstimateService {
	return &EstimateService{store: s, publisher: publisher}
}

// Create validates input, persists a draft estimate, and publishes an EstimateRequested event.
func (s *EstimateService) Create(ctx context.Context, input CreateEstimateInput) (*domain.Estimate, error) {
	if input.TenantID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id is required")
	}
	if input.CaseID == uuid.Nil {
		return nil, fmt.Errorf("case_id is required")
	}
	if input.YourHourlyRate <= 0 {
		return nil, fmt.Errorf("your_hourly_rate must be positive")
	}

	region := input.Region
	if region == "" {
		region = "japan"
	}

	mode := domain.EstimateModeMarketComparison
	if !input.IncludeMarketEvidence {
		mode = domain.EstimateModeHoursOnly
	}

	estimateID := uuid.New()
	estimate := &domain.Estimate{
		ID:                 estimateID,
		TenantID:           input.TenantID,
		CaseID:             input.CaseID,
		EstimateMode:       mode,
		Status:             domain.EstimateStatusDraft,
		YourHourlyRate:     input.YourHourlyRate,
		YourEstimatedHours: 0,
		TotalYourCost:      0,
		Multiplier:         1.8,
		RiskFlags:          []string{},
		PricingSnapshot:    json.RawMessage("{}"),
		HistoricalCitations: json.RawMessage("{}"),
		ThreeWayProposal:   json.RawMessage("{}"),
		GoNoGoResult:       json.RawMessage("{}"),
		ValueProposition:   json.RawMessage("{}"),
	}

	created, err := s.store.Create(ctx, estimate)
	if err != nil {
		return nil, fmt.Errorf("create estimate: %w", err)
	}

	if s.publisher != nil {
		if pubErr := s.publisher.PublishEstimateRequested(ctx, estimateevent.EstimateRequestedInput{
			TenantID:   input.TenantID,
			EstimateID: estimateID,
			CaseID:     input.CaseID,
			Mode:       string(mode),
			Region:     region,
		}); pubErr != nil {
			log.Printf("WARN: failed to publish EstimateRequested event estimate_id=%s error=%v", estimateID, pubErr)
		}
	}

	return created, nil
}

// GetByID returns an estimate by its identifier, scoped to tenant and case.
func (s *EstimateService) GetByID(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error) {
	record, err := s.store.GetByID(ctx, tenantID, caseID, estimateID)
	if err != nil {
		return nil, fmt.Errorf("get estimate: %w", err)
	}
	return record, nil
}

// ListByCaseID returns estimates for a case with pagination.
func (s *EstimateService) ListByCaseID(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error) {
	records, total, err := s.store.ListByCaseID(ctx, tenantID, caseID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list estimates: %w", err)
	}
	return records, total, nil
}

// GetThreeWayProposal returns only the three_way_proposal JSON for an estimate.
func (s *EstimateService) GetThreeWayProposal(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (json.RawMessage, error) {
	record, err := s.store.GetByID(ctx, tenantID, caseID, estimateID)
	if err != nil {
		return nil, fmt.Errorf("get estimate for three_way_proposal: %w", err)
	}
	if record == nil {
		return nil, nil
	}
	return record.ThreeWayProposal, nil
}
