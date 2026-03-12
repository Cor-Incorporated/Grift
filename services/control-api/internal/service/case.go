package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

// CaseService provides business logic for case operations.
type CaseService struct {
	store store.CaseStore
}

// NewCaseService creates a CaseService with the given store dependency.
func NewCaseService(s store.CaseStore) *CaseService {
	return &CaseService{store: s}
}

// CreateInput holds the parameters for creating a new case.
type CreateInput struct {
	Title             string
	CaseType          domain.CaseType
	ExistingSystemURL *string
	CompanyName       *string
	ContactName       *string
	ContactEmail      *string
	CreatedByUID      *string
}

// Create validates input and creates a new case in draft status.
func (s *CaseService) Create(ctx context.Context, tenantID uuid.UUID, in CreateInput) (*domain.Case, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, fmt.Errorf("title is required")
	}
	if len(title) > 200 {
		return nil, fmt.Errorf("title must be 200 characters or fewer")
	}
	if !in.CaseType.IsValid() {
		return nil, fmt.Errorf("invalid case type: %s", in.CaseType)
	}

	c := &domain.Case{
		ID:                uuid.New(),
		TenantID:          tenantID,
		Title:             title,
		Type:              in.CaseType,
		Status:            domain.CaseStatusDraft,
		ExistingSystemURL: in.ExistingSystemURL,
		CompanyName:       in.CompanyName,
		ContactName:       in.ContactName,
		ContactEmail:      in.ContactEmail,
		CreatedByUID:      in.CreatedByUID,
	}

	result, err := s.store.Create(ctx, c)
	if err != nil {
		return nil, fmt.Errorf("creating case: %w", err)
	}

	return result, nil
}

// List returns cases for a tenant with optional filters and pagination.
func (s *CaseService) List(ctx context.Context, tenantID uuid.UUID, statusFilter, typeFilter string, limit, offset int) ([]domain.Case, int, error) {
	cases, total, err := s.store.List(ctx, tenantID, statusFilter, typeFilter, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("listing cases: %w", err)
	}

	return cases, total, nil
}

// Get returns a single case by ID, scoped to a tenant.
// Returns nil if the case does not exist.
func (s *CaseService) Get(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error) {
	c, err := s.store.Get(ctx, tenantID, caseID)
	if err != nil {
		return nil, fmt.Errorf("getting case: %w", err)
	}

	return c, nil
}
