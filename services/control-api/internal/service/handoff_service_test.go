package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

type mockHandoffStore struct {
	createFn              func(context.Context, *domain.HandoffPackage) (*domain.HandoffPackage, error)
	getByCaseIDFn         func(context.Context, uuid.UUID) (*domain.HandoffPackage, error)
	getByIdempotencyKeyFn func(context.Context, uuid.UUID) (*domain.HandoffPackage, error)
	updateStatusFn        func(context.Context, uuid.UUID, domain.HandoffStatus, *string) error
	createIssueMappingFn  func(context.Context, *domain.HandoffIssueMapping) (*domain.HandoffIssueMapping, error)
	listIssueMappingsFn   func(context.Context, uuid.UUID) ([]domain.HandoffIssueMapping, error)
}

func (m *mockHandoffStore) Create(ctx context.Context, h *domain.HandoffPackage) (*domain.HandoffPackage, error) {
	if m.createFn != nil {
		return m.createFn(ctx, h)
	}
	now := time.Now().UTC()
	h.TenantID = uuid.New()
	h.CreatedAt = now
	h.UpdatedAt = now
	return h, nil
}

func (m *mockHandoffStore) GetByCaseID(ctx context.Context, caseID uuid.UUID) (*domain.HandoffPackage, error) {
	if m.getByCaseIDFn != nil {
		return m.getByCaseIDFn(ctx, caseID)
	}
	return nil, nil
}

func (m *mockHandoffStore) GetByIdempotencyKey(ctx context.Context, key uuid.UUID) (*domain.HandoffPackage, error) {
	if m.getByIdempotencyKeyFn != nil {
		return m.getByIdempotencyKeyFn(ctx, key)
	}
	return nil, nil
}

func (m *mockHandoffStore) UpdateStatus(ctx context.Context, id uuid.UUID, status domain.HandoffStatus, errMsg *string) error {
	if m.updateStatusFn != nil {
		return m.updateStatusFn(ctx, id, status, errMsg)
	}
	return nil
}

func (m *mockHandoffStore) CreateIssueMapping(ctx context.Context, mapping *domain.HandoffIssueMapping) (*domain.HandoffIssueMapping, error) {
	if m.createIssueMappingFn != nil {
		return m.createIssueMappingFn(ctx, mapping)
	}
	return mapping, nil
}

func (m *mockHandoffStore) ListIssueMappings(ctx context.Context, handoffID uuid.UUID) ([]domain.HandoffIssueMapping, error) {
	if m.listIssueMappingsFn != nil {
		return m.listIssueMappingsFn(ctx, handoffID)
	}
	return nil, nil
}

type mockEstimateStoreForHandoff struct {
	getByIDFn func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error)
}

func (m *mockEstimateStoreForHandoff) Create(context.Context, *domain.Estimate) (*domain.Estimate, error) {
	return nil, errors.New("unexpected Create call")
}

func (m *mockEstimateStoreForHandoff) GetByID(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, tenantID, caseID, estimateID)
	}
	return nil, nil
}

func (m *mockEstimateStoreForHandoff) ListByCaseID(context.Context, uuid.UUID, uuid.UUID, int, int) ([]domain.Estimate, int, error) {
	return nil, 0, errors.New("unexpected ListByCaseID call")
}

func (m *mockEstimateStoreForHandoff) UpdateThreeWayProposal(context.Context, uuid.UUID, uuid.UUID, json.RawMessage) error {
	return errors.New("unexpected UpdateThreeWayProposal call")
}

type mockHandoffPublisher struct {
	publishFn func(context.Context, *domain.HandoffPackage) error
}

func (m *mockHandoffPublisher) PublishHandoffInitiated(ctx context.Context, handoff *domain.HandoffPackage) error {
	if m.publishFn != nil {
		return m.publishFn(ctx, handoff)
	}
	return nil
}

func TestHandoffServiceCreate(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()
	key := uuid.New()

	t.Run("creates and publishes", func(t *testing.T) {
		var published *domain.HandoffPackage
		store := &mockHandoffStore{
			createFn: func(_ context.Context, h *domain.HandoffPackage) (*domain.HandoffPackage, error) {
				now := time.Now().UTC()
				h.TenantID = tenantID
				h.CreatedAt = now
				h.UpdatedAt = now
				return h, nil
			},
		}
		estimates := &mockEstimateStoreForHandoff{
			getByIDFn: func(_ context.Context, gotTenantID, gotCaseID, gotEstimateID uuid.UUID) (*domain.Estimate, error) {
				if gotTenantID != tenantID || gotCaseID != caseID || gotEstimateID != estimateID {
					t.Fatalf("GetByID() got (%v,%v,%v)", gotTenantID, gotCaseID, gotEstimateID)
				}
				return &domain.Estimate{ID: estimateID}, nil
			},
		}
		publisher := &mockHandoffPublisher{
			publishFn: func(_ context.Context, handoff *domain.HandoffPackage) error {
				published = handoff
				return nil
			},
		}

		svc := NewHandoffService(store, estimates, publisher)
		ctx := withTenantContext(t, tenantID)
		got, err := svc.Create(ctx, caseID, estimateID, key)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if got.Status != domain.HandoffStatusPending {
			t.Fatalf("Create() status = %q, want %q", got.Status, domain.HandoffStatusPending)
		}
		if published == nil || published.ID != got.ID {
			t.Fatal("Create() did not publish created handoff")
		}
	})

	t.Run("returns existing for same idempotency key", func(t *testing.T) {
		existing := &domain.HandoffPackage{ID: uuid.New(), CaseID: caseID, EstimateID: estimateID, IdempotencyKey: key}
		svc := NewHandoffService(&mockHandoffStore{
			getByIdempotencyKeyFn: func(context.Context, uuid.UUID) (*domain.HandoffPackage, error) {
				return existing, nil
			},
		}, &mockEstimateStoreForHandoff{}, nil)

		got, err := svc.Create(withTenantContext(t, tenantID), caseID, estimateID, key)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if got.ID != existing.ID {
			t.Fatalf("Create() id = %v, want %v", got.ID, existing.ID)
		}
	})

	t.Run("returns conflict for mismatched idempotent request", func(t *testing.T) {
		existing := &domain.HandoffPackage{ID: uuid.New(), CaseID: uuid.New(), EstimateID: estimateID, IdempotencyKey: key}
		svc := NewHandoffService(&mockHandoffStore{
			getByIdempotencyKeyFn: func(context.Context, uuid.UUID) (*domain.HandoffPackage, error) {
				return existing, nil
			},
		}, &mockEstimateStoreForHandoff{}, nil)

		_, err := svc.Create(withTenantContext(t, tenantID), caseID, estimateID, key)
		if !errors.Is(err, ErrIdempotencyConflict) {
			t.Fatalf("Create() error = %v, want %v", err, ErrIdempotencyConflict)
		}
	})

	t.Run("estimate not found", func(t *testing.T) {
		svc := NewHandoffService(&mockHandoffStore{}, &mockEstimateStoreForHandoff{
			getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
				return nil, nil
			},
		}, nil)

		_, err := svc.Create(withTenantContext(t, tenantID), caseID, estimateID, key)
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("Create() error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("tolerates publish failure", func(t *testing.T) {
		svc := NewHandoffService(&mockHandoffStore{}, &mockEstimateStoreForHandoff{
			getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
				return &domain.Estimate{ID: estimateID}, nil
			},
		}, &mockHandoffPublisher{
			publishFn: func(context.Context, *domain.HandoffPackage) error {
				return errors.New("pubsub unavailable")
			},
		})

		if _, err := svc.Create(withTenantContext(t, tenantID), caseID, estimateID, key); err != nil {
			t.Fatalf("Create() error = %v", err)
		}
	})

	t.Run("returns existing after unique violation", func(t *testing.T) {
		existing := &domain.HandoffPackage{ID: uuid.New(), CaseID: caseID, EstimateID: estimateID, IdempotencyKey: key}
		calls := 0
		store := &mockHandoffStore{
			getByIdempotencyKeyFn: func(context.Context, uuid.UUID) (*domain.HandoffPackage, error) {
				calls++
				if calls == 1 {
					return nil, nil
				}
				return existing, nil
			},
			createFn: func(context.Context, *domain.HandoffPackage) (*domain.HandoffPackage, error) {
				return nil, &pq.Error{Code: "23505"}
			},
		}
		svc := NewHandoffService(store, &mockEstimateStoreForHandoff{
			getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
				return &domain.Estimate{ID: estimateID}, nil
			},
		}, nil)

		got, err := svc.Create(withTenantContext(t, tenantID), caseID, estimateID, key)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if got.ID != existing.ID {
			t.Fatalf("Create() id = %v, want %v", got.ID, existing.ID)
		}
	})
}

func TestHandoffServiceGetByCaseID(t *testing.T) {
	caseID := uuid.New()
	handoffID := uuid.New()
	issueID := "LIN-22"

	t.Run("returns handoff with mappings", func(t *testing.T) {
		svc := NewHandoffService(&mockHandoffStore{
			getByCaseIDFn: func(context.Context, uuid.UUID) (*domain.HandoffPackage, error) {
				return &domain.HandoffPackage{ID: handoffID, CaseID: caseID}, nil
			},
			listIssueMappingsFn: func(context.Context, uuid.UUID) ([]domain.HandoffIssueMapping, error) {
				return []domain.HandoffIssueMapping{{ModuleName: "billing", LinearIssueID: &issueID}}, nil
			},
		}, &mockEstimateStoreForHandoff{}, nil)

		handoff, mappings, err := svc.GetByCaseID(context.Background(), caseID)
		if err != nil {
			t.Fatalf("GetByCaseID() error = %v", err)
		}
		if handoff.ID != handoffID || len(mappings) != 1 {
			t.Fatalf("GetByCaseID() got (%v,%d)", handoff.ID, len(mappings))
		}
	})

	t.Run("returns not found", func(t *testing.T) {
		svc := NewHandoffService(&mockHandoffStore{}, &mockEstimateStoreForHandoff{}, nil)
		_, _, err := svc.GetByCaseID(context.Background(), caseID)
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("GetByCaseID() error = %v, want %v", err, ErrNotFound)
		}
	})
}

func withTenantContext(t *testing.T, tenantID uuid.UUID) context.Context {
	t.Helper()

	var ctx context.Context
	handler := middleware.Tenant(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		ctx = r.Context()
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("middleware status = %d, want %d", rec.Code, http.StatusOK)
	}
	return ctx
}
