package service

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

// mockTenantStore implements store.TenantStore for service tests.
type mockTenantStore struct {
	createFn         func(ctx context.Context, t *domain.Tenant) (*domain.Tenant, error)
	listFn           func(ctx context.Context, limit, offset int) ([]domain.Tenant, int, error)
	getByIDFn        func(ctx context.Context, tenantID uuid.UUID) (*domain.Tenant, error)
	updateSettingsFn func(ctx context.Context, tenantID uuid.UUID, analyticsOptIn, trainingOptIn *bool, settings json.RawMessage) (*domain.Tenant, error)
	addMemberFn      func(ctx context.Context, m *domain.TenantMember) (*domain.TenantMember, error)
	listMembersFn              func(ctx context.Context, tenantID uuid.UUID, limit, offset int) ([]domain.TenantMember, int, error)
	getMemberByFirebaseUIDFn   func(ctx context.Context, tenantID uuid.UUID, firebaseUID string) (*domain.TenantMember, error)
}

var _ store.TenantStore = (*mockTenantStore)(nil)

func (m *mockTenantStore) Create(ctx context.Context, t *domain.Tenant) (*domain.Tenant, error) {
	if m.createFn != nil {
		return m.createFn(ctx, t)
	}
	now := time.Now()
	t.CreatedAt = now
	t.UpdatedAt = now
	return t, nil
}

func (m *mockTenantStore) List(ctx context.Context, limit, offset int) ([]domain.Tenant, int, error) {
	if m.listFn != nil {
		return m.listFn(ctx, limit, offset)
	}
	return nil, 0, nil
}

func (m *mockTenantStore) GetByID(ctx context.Context, tenantID uuid.UUID) (*domain.Tenant, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, tenantID)
	}
	return nil, nil
}

func (m *mockTenantStore) UpdateSettings(ctx context.Context, tenantID uuid.UUID, analyticsOptIn, trainingOptIn *bool, settings json.RawMessage) (*domain.Tenant, error) {
	if m.updateSettingsFn != nil {
		return m.updateSettingsFn(ctx, tenantID, analyticsOptIn, trainingOptIn, settings)
	}
	now := time.Now()
	return &domain.Tenant{
		ID:        tenantID,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

func (m *mockTenantStore) AddMember(ctx context.Context, mb *domain.TenantMember) (*domain.TenantMember, error) {
	if m.addMemberFn != nil {
		return m.addMemberFn(ctx, mb)
	}
	now := time.Now()
	mb.CreatedAt = now
	mb.UpdatedAt = now
	return mb, nil
}

func (m *mockTenantStore) ListMembers(ctx context.Context, tenantID uuid.UUID, limit, offset int) ([]domain.TenantMember, int, error) {
	if m.listMembersFn != nil {
		return m.listMembersFn(ctx, tenantID, limit, offset)
	}
	return nil, 0, nil
}

func (m *mockTenantStore) GetMemberByFirebaseUID(ctx context.Context, tenantID uuid.UUID, firebaseUID string) (*domain.TenantMember, error) {
	if m.getMemberByFirebaseUIDFn != nil {
		return m.getMemberByFirebaseUIDFn(ctx, tenantID, firebaseUID)
	}
	return nil, nil
}

func TestTenantService_Create(t *testing.T) {
	tests := []struct {
		name    string
		input   CreateTenantInput
		storeFn func(ctx context.Context, t *domain.Tenant) (*domain.Tenant, error)
		wantErr bool
	}{
		{
			name:    "valid input",
			input:   CreateTenantInput{Name: "Acme Corp", Slug: "acme-corp"},
			wantErr: false,
		},
		{
			name:    "empty name",
			input:   CreateTenantInput{Name: "", Slug: "acme-corp"},
			wantErr: true,
		},
		{
			name:    "whitespace-only name",
			input:   CreateTenantInput{Name: "   ", Slug: "acme-corp"},
			wantErr: true,
		},
		{
			name:    "empty slug",
			input:   CreateTenantInput{Name: "Acme Corp", Slug: ""},
			wantErr: true,
		},
		{
			name:    "invalid slug with uppercase",
			input:   CreateTenantInput{Name: "Acme Corp", Slug: "Acme-Corp"},
			wantErr: true,
		},
		{
			name:    "invalid slug with spaces",
			input:   CreateTenantInput{Name: "Acme Corp", Slug: "acme corp"},
			wantErr: true,
		},
		{
			name:    "invalid slug with special characters",
			input:   CreateTenantInput{Name: "Acme Corp", Slug: "acme_corp!"},
			wantErr: true,
		},
		{
			name:    "valid slug with numbers and hyphens",
			input:   CreateTenantInput{Name: "Acme 123", Slug: "acme-123"},
			wantErr: false,
		},
		{
			name:  "store error",
			input: CreateTenantInput{Name: "Acme Corp", Slug: "acme-corp"},
			storeFn: func(_ context.Context, _ *domain.Tenant) (*domain.Tenant, error) {
				return nil, fmt.Errorf("db unavailable")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewTenantService(&mockTenantStore{createFn: tt.storeFn})

			got, err := s.Create(context.Background(), tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Create() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if got.Plan != domain.PlanFree {
				t.Errorf("Create() plan = %v, want %v", got.Plan, domain.PlanFree)
			}
			if got.Name != tt.input.Name {
				t.Errorf("Create() name = %v, want %v", got.Name, tt.input.Name)
			}
			if got.Slug != tt.input.Slug {
				t.Errorf("Create() slug = %v, want %v", got.Slug, tt.input.Slug)
			}
		})
	}
}

func TestTenantService_List(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name      string
		storeFn   func(ctx context.Context, limit, offset int) ([]domain.Tenant, int, error)
		wantCount int
		wantTotal int
		wantErr   bool
	}{
		{
			name: "success with results",
			storeFn: func(_ context.Context, _, _ int) ([]domain.Tenant, int, error) {
				return []domain.Tenant{
					{ID: uuid.New(), Name: "Tenant 1", CreatedAt: now, UpdatedAt: now},
					{ID: uuid.New(), Name: "Tenant 2", CreatedAt: now, UpdatedAt: now},
				}, 2, nil
			},
			wantCount: 2,
			wantTotal: 2,
		},
		{
			name: "empty results",
			storeFn: func(_ context.Context, _, _ int) ([]domain.Tenant, int, error) {
				return nil, 0, nil
			},
			wantCount: 0,
			wantTotal: 0,
		},
		{
			name: "store error",
			storeFn: func(_ context.Context, _, _ int) ([]domain.Tenant, int, error) {
				return nil, 0, fmt.Errorf("connection refused")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewTenantService(&mockTenantStore{listFn: tt.storeFn})

			got, total, err := s.List(context.Background(), 20, 0)
			if (err != nil) != tt.wantErr {
				t.Fatalf("List() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if len(got) != tt.wantCount {
				t.Errorf("List() count = %d, want %d", len(got), tt.wantCount)
			}
			if total != tt.wantTotal {
				t.Errorf("List() total = %d, want %d", total, tt.wantTotal)
			}
		})
	}
}

func TestTenantService_UpdateSettings(t *testing.T) {
	tenantID := uuid.New()
	now := time.Now()

	tests := []struct {
		name      string
		getByIDFn func(ctx context.Context, tid uuid.UUID) (*domain.Tenant, error)
		updateFn  func(ctx context.Context, tid uuid.UUID, a, tr *bool, s json.RawMessage) (*domain.Tenant, error)
		input     UpdateSettingsInput
		wantErr   bool
	}{
		{
			name: "valid update analytics opt-in",
			getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.Tenant, error) {
				return &domain.Tenant{ID: tenantID, Name: "Test", CreatedAt: now, UpdatedAt: now}, nil
			},
			input:   UpdateSettingsInput{AnalyticsOptIn: boolPtr(true)},
			wantErr: false,
		},
		{
			name: "tenant not found",
			getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.Tenant, error) {
				return nil, nil
			},
			input:   UpdateSettingsInput{AnalyticsOptIn: boolPtr(true)},
			wantErr: true,
		},
		{
			name: "store get error",
			getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.Tenant, error) {
				return nil, fmt.Errorf("db error")
			},
			input:   UpdateSettingsInput{},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewTenantService(&mockTenantStore{
				getByIDFn:        tt.getByIDFn,
				updateSettingsFn: tt.updateFn,
			})

			_, err := s.UpdateSettings(context.Background(), tenantID, tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("UpdateSettings() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestTenantService_AddMember(t *testing.T) {
	tenantID := uuid.New()

	tests := []struct {
		name    string
		input   AddMemberInput
		storeFn func(ctx context.Context, m *domain.TenantMember) (*domain.TenantMember, error)
		wantErr bool
	}{
		{
			name: "valid member",
			input: AddMemberInput{
				FirebaseUID: "firebase-uid-123",
				Role:        domain.MemberRoleMember,
			},
			wantErr: false,
		},
		{
			name: "empty firebase_uid",
			input: AddMemberInput{
				FirebaseUID: "",
				Role:        domain.MemberRoleMember,
			},
			wantErr: true,
		},
		{
			name: "invalid role",
			input: AddMemberInput{
				FirebaseUID: "firebase-uid-123",
				Role:        domain.MemberRole("superadmin"),
			},
			wantErr: true,
		},
		{
			name: "store error",
			input: AddMemberInput{
				FirebaseUID: "firebase-uid-123",
				Role:        domain.MemberRoleAdmin,
			},
			storeFn: func(_ context.Context, _ *domain.TenantMember) (*domain.TenantMember, error) {
				return nil, fmt.Errorf("unique constraint violation")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewTenantService(&mockTenantStore{addMemberFn: tt.storeFn})

			got, err := s.AddMember(context.Background(), tenantID, tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("AddMember() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if got.TenantID != tenantID {
				t.Errorf("AddMember() tenantID = %v, want %v", got.TenantID, tenantID)
			}
			if got.Role != tt.input.Role {
				t.Errorf("AddMember() role = %v, want %v", got.Role, tt.input.Role)
			}
			if !got.Active {
				t.Error("AddMember() active = false, want true")
			}
		})
	}
}

func TestTenantService_ListMembers(t *testing.T) {
	tenantID := uuid.New()
	now := time.Now()

	tests := []struct {
		name      string
		storeFn   func(ctx context.Context, tid uuid.UUID, limit, offset int) ([]domain.TenantMember, int, error)
		wantCount int
		wantTotal int
		wantErr   bool
	}{
		{
			name: "success with results",
			storeFn: func(_ context.Context, _ uuid.UUID, _, _ int) ([]domain.TenantMember, int, error) {
				return []domain.TenantMember{
					{ID: uuid.New(), TenantID: tenantID, FirebaseUID: "uid1", Role: domain.MemberRoleOwner, CreatedAt: now, UpdatedAt: now},
				}, 1, nil
			},
			wantCount: 1,
			wantTotal: 1,
		},
		{
			name: "store error",
			storeFn: func(_ context.Context, _ uuid.UUID, _, _ int) ([]domain.TenantMember, int, error) {
				return nil, 0, fmt.Errorf("timeout")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewTenantService(&mockTenantStore{listMembersFn: tt.storeFn})

			got, total, err := s.ListMembers(context.Background(), tenantID, 20, 0)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ListMembers() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if len(got) != tt.wantCount {
				t.Errorf("ListMembers() count = %d, want %d", len(got), tt.wantCount)
			}
			if total != tt.wantTotal {
				t.Errorf("ListMembers() total = %d, want %d", total, tt.wantTotal)
			}
		})
	}
}

func boolPtr(b bool) *bool {
	return &b
}
