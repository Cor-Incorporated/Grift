package service

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

// mockCaseStore implements store.CaseStore for service tests.
type mockCaseStore struct {
	createFn           func(ctx context.Context, c *domain.Case) (*domain.Case, error)
	listFn             func(ctx context.Context, tenantID uuid.UUID, statusFilter, typeFilter string, limit, offset int) ([]domain.Case, int, error)
	getFn              func(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error)
	updateFn           func(ctx context.Context, tenantID, caseID uuid.UUID, fields store.UpdateCaseFields) (*domain.Case, error)
	deleteFn           func(ctx context.Context, tenantID, caseID uuid.UUID) error
	transitionStatusFn func(ctx context.Context, tenantID, caseID uuid.UUID, from, to domain.CaseStatus) (bool, error)
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

func (m *mockCaseStore) Update(ctx context.Context, tenantID, caseID uuid.UUID, fields store.UpdateCaseFields) (*domain.Case, error) {
	if m.updateFn != nil {
		return m.updateFn(ctx, tenantID, caseID, fields)
	}
	return &domain.Case{
		ID:        caseID,
		TenantID:  tenantID,
		Title:     "updated",
		Type:      domain.CaseTypeNewProject,
		Status:    domain.CaseStatusDraft,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}, nil
}

func (m *mockCaseStore) Delete(ctx context.Context, tenantID, caseID uuid.UUID) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, tenantID, caseID)
	}
	return nil
}

func (m *mockCaseStore) TransitionStatus(ctx context.Context, tenantID, caseID uuid.UUID, from, to domain.CaseStatus) (bool, error) {
	if m.transitionStatusFn != nil {
		return m.transitionStatusFn(ctx, tenantID, caseID, from, to)
	}
	return false, nil
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

func TestCaseService_Update(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	now := time.Now()

	validTitle := "Updated title"
	invalidType := "bad_type"
	validType := "bug_report"
	invalidStatus := "wrong"
	validStatus := "analyzing"
	invalidPriority := "super"
	validPriority := "high"

	tests := []struct {
		name    string
		input   UpdateInput
		storeFn func(ctx context.Context, tid, cid uuid.UUID, f store.UpdateCaseFields) (*domain.Case, error)
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid title update",
			input: UpdateInput{
				Title: &validTitle,
			},
			storeFn: func(_ context.Context, _, _ uuid.UUID, _ store.UpdateCaseFields) (*domain.Case, error) {
				return &domain.Case{
					ID: caseID, TenantID: tenantID, Title: validTitle,
					Type: domain.CaseTypeNewProject, Status: domain.CaseStatusDraft,
					CreatedAt: now, UpdatedAt: now,
				}, nil
			},
		},
		{
			name:  "valid multi-field update",
			input: UpdateInput{Title: &validTitle, Type: &validType, Status: &validStatus, Priority: &validPriority},
		},
		{
			name:    "invalid type",
			input:   UpdateInput{Type: &invalidType},
			wantErr: true,
			errMsg:  "invalid case type",
		},
		{
			name:    "invalid status",
			input:   UpdateInput{Status: &invalidStatus},
			wantErr: true,
			errMsg:  "invalid case status",
		},
		{
			name:    "invalid priority",
			input:   UpdateInput{Priority: &invalidPriority},
			wantErr: true,
			errMsg:  "invalid case priority",
		},
		{
			name:  "not found",
			input: UpdateInput{Title: &validTitle},
			storeFn: func(_ context.Context, _, _ uuid.UUID, _ store.UpdateCaseFields) (*domain.Case, error) {
				return nil, sql.ErrNoRows
			},
			wantErr: true,
			errMsg:  "not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewCaseService(&mockCaseStore{updateFn: tt.storeFn})

			got, err := svc.Update(context.Background(), tenantID, caseID, tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Update() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil {
				if tt.errMsg != "" && !contains(err.Error(), tt.errMsg) {
					t.Errorf("Update() error = %v, want containing %q", err, tt.errMsg)
				}
				return
			}
			if got == nil {
				t.Fatal("Update() returned nil, want non-nil")
			}
		})
	}
}

func TestCaseService_Delete(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()

	tests := []struct {
		name    string
		storeFn func(ctx context.Context, tid, cid uuid.UUID) error
		wantErr bool
		errMsg  string
	}{
		{
			name: "success",
		},
		{
			name: "not found",
			storeFn: func(_ context.Context, _, _ uuid.UUID) error {
				return sql.ErrNoRows
			},
			wantErr: true,
			errMsg:  "not found",
		},
		{
			name: "store error",
			storeFn: func(_ context.Context, _, _ uuid.UUID) error {
				return fmt.Errorf("connection refused")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewCaseService(&mockCaseStore{deleteFn: tt.storeFn})

			err := svc.Delete(context.Background(), tenantID, caseID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Delete() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil && tt.errMsg != "" && !contains(err.Error(), tt.errMsg) {
				t.Errorf("Delete() error = %v, want containing %q", err, tt.errMsg)
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchSubstring(s, substr)
}

func searchSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
