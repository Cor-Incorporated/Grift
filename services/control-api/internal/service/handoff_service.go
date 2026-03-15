package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// ErrIdempotencyConflict indicates an idempotency key collision for a different handoff.
var ErrIdempotencyConflict = errors.New("idempotency_key already used for a different handoff")

// EventPublisher publishes handoff workflow events.
type EventPublisher interface {
	PublishHandoffInitiated(ctx context.Context, handoff *domain.HandoffPackage) error
}

// HandoffService handles handoff creation and retrieval.
// TODO: Add LinearClient field when intelligence-worker triggers Linear sync via HandoffInitiated event.
type HandoffService struct {
	store     store.HandoffStore
	estimates store.EstimateStore
	publisher EventPublisher
}

// NewHandoffService constructs a HandoffService.
func NewHandoffService(s store.HandoffStore, estimates store.EstimateStore, publisher EventPublisher) *HandoffService {
	return &HandoffService{
		store:     s,
		estimates: estimates,
		publisher: publisher,
	}
}

// Create validates input, persists a pending handoff package, and publishes HandoffInitiated.
func (s *HandoffService) Create(ctx context.Context, caseID, estimateID, idempotencyKey uuid.UUID) (*domain.HandoffPackage, error) {
	if caseID == uuid.Nil {
		return nil, fmt.Errorf("case_id is required")
	}
	if estimateID == uuid.Nil {
		return nil, fmt.Errorf("estimate_id is required")
	}
	if idempotencyKey == uuid.Nil {
		return nil, fmt.Errorf("idempotency_key is required")
	}

	existing, err := s.store.GetByIdempotencyKey(ctx, idempotencyKey)
	if err != nil {
		return nil, fmt.Errorf("get handoff by idempotency key: %w", err)
	}
	if existing != nil {
		return matchExistingHandoff(existing, caseID, estimateID)
	}

	tenantID, err := tenantIDFromContext(ctx)
	if err != nil {
		return nil, err
	}
	estimate, err := s.estimates.GetByID(ctx, tenantID, caseID, estimateID)
	if err != nil {
		return nil, fmt.Errorf("get estimate for handoff: %w", err)
	}
	if estimate == nil {
		return nil, ErrNotFound
	}

	handoff := &domain.HandoffPackage{
		ID:             uuid.New(),
		CaseID:         caseID,
		EstimateID:     estimateID,
		Status:         domain.HandoffStatusPending,
		IdempotencyKey: idempotencyKey,
	}

	created, err := s.store.Create(ctx, handoff)
	if err != nil {
		return s.handleCreateError(ctx, err, caseID, estimateID, idempotencyKey)
	}
	s.publishCreated(ctx, created)
	return created, nil
}

// GetByCaseID returns a handoff package and its issue mappings for the case.
func (s *HandoffService) GetByCaseID(ctx context.Context, caseID uuid.UUID) (*domain.HandoffPackage, []domain.HandoffIssueMapping, error) {
	if caseID == uuid.Nil {
		return nil, nil, fmt.Errorf("case_id is required")
	}

	handoff, err := s.store.GetByCaseID(ctx, caseID)
	if err != nil {
		return nil, nil, fmt.Errorf("get handoff by case: %w", err)
	}
	if handoff == nil {
		return nil, nil, ErrNotFound
	}

	mappings, err := s.store.ListIssueMappings(ctx, handoff.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("list handoff issue mappings: %w", err)
	}
	return handoff, mappings, nil
}

func (s *HandoffService) handleCreateError(
	ctx context.Context,
	err error,
	caseID, estimateID, idempotencyKey uuid.UUID,
) (*domain.HandoffPackage, error) {
	if !isUniqueViolation(err) {
		return nil, fmt.Errorf("create handoff package: %w", err)
	}

	existing, getErr := s.store.GetByIdempotencyKey(ctx, idempotencyKey)
	if getErr != nil {
		return nil, fmt.Errorf("get handoff after idempotency conflict: %w", getErr)
	}
	if existing == nil {
		return nil, fmt.Errorf("create handoff package: %w", err)
	}
	return matchExistingHandoff(existing, caseID, estimateID)
}

func (s *HandoffService) publishCreated(ctx context.Context, handoff *domain.HandoffPackage) {
	if s.publisher == nil {
		return
	}
	if err := s.publisher.PublishHandoffInitiated(ctx, handoff); err != nil {
		slog.WarnContext(ctx, "failed to publish HandoffInitiated event",
			"handoff_id", handoff.ID.String(),
			"error", err,
		)
	}
}

func matchExistingHandoff(existing *domain.HandoffPackage, caseID, estimateID uuid.UUID) (*domain.HandoffPackage, error) {
	if existing.CaseID != caseID || existing.EstimateID != estimateID {
		return nil, ErrIdempotencyConflict
	}
	return existing, nil
}

func tenantIDFromContext(ctx context.Context) (uuid.UUID, error) {
	raw := strings.TrimSpace(middleware.TenantIDFromContext(ctx))
	if raw == "" {
		return uuid.Nil, fmt.Errorf("tenant_id is required")
	}
	tenantID, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("tenant_id is invalid")
	}
	return tenantID, nil
}

func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "23505"
}
