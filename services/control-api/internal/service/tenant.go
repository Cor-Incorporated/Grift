package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

var slugRegex = regexp.MustCompile(`^[a-z0-9-]+$`)

// TenantService provides business logic for tenant operations.
type TenantService struct {
	store store.TenantStore
}

// NewTenantService creates a TenantService with the given store dependency.
func NewTenantService(s store.TenantStore) *TenantService {
	return &TenantService{store: s}
}

// CreateTenantInput holds the parameters for creating a new tenant.
type CreateTenantInput struct {
	Name string
	Slug string
}

// Create validates input and creates a new tenant with default plan "free".
func (s *TenantService) Create(ctx context.Context, in CreateTenantInput) (*domain.Tenant, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, fmt.Errorf("name is required")
	}

	slug := strings.TrimSpace(in.Slug)
	if slug == "" {
		return nil, fmt.Errorf("slug is required")
	}
	if !slugRegex.MatchString(slug) {
		return nil, fmt.Errorf("slug must match ^[a-z0-9-]+$")
	}

	t := &domain.Tenant{
		ID:             uuid.New(),
		Name:           name,
		Slug:           slug,
		Plan:           domain.PlanFree,
		Settings:       json.RawMessage(`{}`),
		AnalyticsOptIn: false,
		TrainingOptIn:  false,
	}

	result, err := s.store.Create(ctx, t)
	if err != nil {
		return nil, fmt.Errorf("creating tenant: %w", err)
	}

	return result, nil
}

// List returns tenants with pagination.
func (s *TenantService) List(ctx context.Context, limit, offset int) ([]domain.Tenant, int, error) {
	tenants, total, err := s.store.List(ctx, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("listing tenants: %w", err)
	}

	return tenants, total, nil
}

// UpdateSettingsInput holds the parameters for updating tenant settings.
type UpdateSettingsInput struct {
	AnalyticsOptIn *bool
	TrainingOptIn  *bool
	Settings       json.RawMessage
}

// UpdateSettings verifies the tenant exists and applies a partial update.
func (s *TenantService) UpdateSettings(ctx context.Context, tenantID uuid.UUID, in UpdateSettingsInput) (*domain.Tenant, error) {
	existing, err := s.store.GetByID(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("checking tenant: %w", err)
	}
	if existing == nil {
		return nil, fmt.Errorf("tenant not found")
	}

	result, err := s.store.UpdateSettings(ctx, tenantID, in.AnalyticsOptIn, in.TrainingOptIn, in.Settings)
	if err != nil {
		return nil, fmt.Errorf("updating tenant settings: %w", err)
	}

	return result, nil
}

// AddMemberInput holds the parameters for adding a tenant member.
type AddMemberInput struct {
	FirebaseUID string
	Email       *string
	DisplayName *string
	Role        domain.MemberRole
}

// AddMember validates the role and creates a new tenant member.
func (s *TenantService) AddMember(ctx context.Context, tenantID uuid.UUID, in AddMemberInput) (*domain.TenantMember, error) {
	uid := strings.TrimSpace(in.FirebaseUID)
	if uid == "" {
		return nil, fmt.Errorf("firebase_uid is required")
	}

	if !in.Role.IsValid() {
		return nil, fmt.Errorf("invalid role: %s", in.Role)
	}

	m := &domain.TenantMember{
		ID:          uuid.New(),
		TenantID:    tenantID,
		FirebaseUID: uid,
		Email:       in.Email,
		DisplayName: in.DisplayName,
		Role:        in.Role,
		Active:      true,
	}

	result, err := s.store.AddMember(ctx, m)
	if err != nil {
		return nil, fmt.Errorf("adding tenant member: %w", err)
	}

	return result, nil
}

// IsTenantAdmin checks if the user (by Firebase UID) has admin-level access
// to the specified tenant. Returns true for owner or admin roles.
func (s *TenantService) IsTenantAdmin(ctx context.Context, tenantID uuid.UUID, firebaseUID string) (bool, error) {
	member, err := s.store.GetMemberByFirebaseUID(ctx, tenantID, firebaseUID)
	if err != nil {
		return false, fmt.Errorf("checking tenant admin: %w", err)
	}
	if member == nil {
		return false, nil
	}
	return member.Role == domain.MemberRoleOwner || member.Role == domain.MemberRoleAdmin, nil
}

// ListMembers returns members for a tenant with pagination.
func (s *TenantService) ListMembers(ctx context.Context, tenantID uuid.UUID, limit, offset int) ([]domain.TenantMember, int, error) {
	members, total, err := s.store.ListMembers(ctx, tenantID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("listing tenant members: %w", err)
	}

	return members, total, nil
}
