package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

// mockCaseStore implements store.CaseStore for service tests.
type mockCaseStore struct {
	createFn func(ctx context.Context, c *domain.Case) (*domain.Case, error)
	listFn   func(ctx context.Context, tenantID uuid.UUID, statusFilter, typeFilter string, limit, offset int) ([]domain.Case, int, error)
	getFn    func(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error)
}

var _ store.CaseStore = (*mockCaseStore)(nil)

func (m *mockCaseStore) Create(ctx context.Context, c *domain.Case) (*domain.Case, error) {
	if m.createFn != nil {
		return m.createFn(ctx, c)
	}
	now := time.Now()
	c.CreatedAt = now
	c.UpdatedAt = now
	return c, nil
}

func (m *mockCaseStore) List(ctx context.Context, tenantID uuid.UUID, statusFilter, typeFilter string, limit, offset int) ([]domain.Case, int, error) {
	if m.listFn != nil {
		return m.listFn(ctx, tenantID, statusFilter, typeFilter, limit, offset)
	}
	return nil, 0, nil
}

func (m *mockCaseStore) Get(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error) {
	if m.getFn != nil {
		return m.getFn(ctx, tenantID, caseID)
	}
	return nil, nil
}

func TestCaseService_Create(t *testing.T) {
	tests := []struct {
		name     string
		input    CreateInput
		storeFn  func(ctx context.Context, c *domain.Case) (*domain.Case, error)
		wantErr  bool
		wantType domain.CaseType
	}{
		{
			name: "valid input",
			input: CreateInput{
				Title:    "New project intake",
				CaseType: domain.CaseTypeNewProject,
			},
			wantErr:  false,
			wantType: domain.CaseTypeNewProject,
		},
		{
			name: "empty title",
			input: CreateInput{
				Title:    "",
				CaseType: domain.CaseTypeNewProject,
			},
			wantErr: true,
		},
		{
			name: "whitespace-only title",
			input: CreateInput{
				Title:    "   ",
				CaseType: domain.CaseTypeNewProject,
			},
			wantErr: true,
		},
		{
			name: "invalid case type",
			input: CreateInput{
				Title:    "Valid title",
				CaseType: domain.CaseType("invalid"),
			},
			wantErr: true,
		},
		{
			name: "store error",
			input: CreateInput{
				Title:    "Valid title",
				CaseType: domain.CaseTypeBugReport,
			},
			storeFn: func(_ context.Context, _ *domain.Case) (*domain.Case, error) {
				return nil, fmt.Errorf("db unavailable")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewCaseService(&mockCaseStore{createFn: tt.storeFn})
			tenantID := uuid.New()

			got, err := s.Create(context.Background(), tenantID, tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Create() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if got.Type != tt.wantType {
				t.Errorf("Create() type = %v, want %v", got.Type, tt.wantType)
			}
			if got.Status != domain.CaseStatusDraft {
				t.Errorf("Create() status = %v, want %v", got.Status, domain.CaseStatusDraft)
			}
			if got.TenantID != tenantID {
				t.Errorf("Create() tenantID = %v, want %v", got.TenantID, tenantID)
			}
		})
	}
}

func TestCaseService_List(t *testing.T) {
	tenantID := uuid.New()
	now := time.Now()

	tests := []struct {
		name      string
		storeFn   func(ctx context.Context, tid uuid.UUID, sf, tf string, l, o int) ([]domain.Case, int, error)
		wantCount int
		wantTotal int
		wantErr   bool
	}{
		{
			name: "success with results",
			storeFn: func(_ context.Context, _ uuid.UUID, _, _ string, _, _ int) ([]domain.Case, int, error) {
				return []domain.Case{
					{ID: uuid.New(), TenantID: tenantID, Title: "Case 1", CreatedAt: now, UpdatedAt: now},
					{ID: uuid.New(), TenantID: tenantID, Title: "Case 2", CreatedAt: now, UpdatedAt: now},
				}, 2, nil
			},
			wantCount: 2,
			wantTotal: 2,
		},
		{
			name: "empty results",
			storeFn: func(_ context.Context, _ uuid.UUID, _, _ string, _, _ int) ([]domain.Case, int, error) {
				return nil, 0, nil
			},
			wantCount: 0,
			wantTotal: 0,
		},
		{
			name: "store error",
			storeFn: func(_ context.Context, _ uuid.UUID, _, _ string, _, _ int) ([]domain.Case, int, error) {
				return nil, 0, fmt.Errorf("connection refused")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewCaseService(&mockCaseStore{listFn: tt.storeFn})

			got, total, err := s.List(context.Background(), tenantID, "", "", 20, 0)
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

func TestCaseService_Get(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	now := time.Now()

	tests := []struct {
		name    string
		storeFn func(ctx context.Context, tid, cid uuid.UUID) (*domain.Case, error)
		wantNil bool
		wantErr bool
	}{
		{
			name: "found",
			storeFn: func(_ context.Context, _, _ uuid.UUID) (*domain.Case, error) {
				return &domain.Case{
					ID:        caseID,
					TenantID:  tenantID,
					Title:     "Test case",
					Type:      domain.CaseTypeNewProject,
					Status:    domain.CaseStatusDraft,
					CreatedAt: now,
					UpdatedAt: now,
				}, nil
			},
		},
		{
			name: "not found",
			storeFn: func(_ context.Context, _, _ uuid.UUID) (*domain.Case, error) {
				return nil, nil
			},
			wantNil: true,
		},
		{
			name: "store error",
			storeFn: func(_ context.Context, _, _ uuid.UUID) (*domain.Case, error) {
				return nil, fmt.Errorf("timeout")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewCaseService(&mockCaseStore{getFn: tt.storeFn})

			got, err := s.Get(context.Background(), tenantID, caseID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Get() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if tt.wantNil && got != nil {
				t.Errorf("Get() = %v, want nil", got)
			}
			if !tt.wantNil && got == nil {
				t.Error("Get() = nil, want non-nil")
			}
		})
	}
}
