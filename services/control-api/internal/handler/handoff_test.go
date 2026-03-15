package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

type fakeHandoffStore struct {
	createFn              func(context.Context, *domain.HandoffPackage) (*domain.HandoffPackage, error)
	getByCaseIDFn         func(context.Context, uuid.UUID) (*domain.HandoffPackage, error)
	getByIdempotencyKeyFn func(context.Context, uuid.UUID) (*domain.HandoffPackage, error)
	listIssueMappingsFn   func(context.Context, uuid.UUID) ([]domain.HandoffIssueMapping, error)
}

func (f *fakeHandoffStore) Create(ctx context.Context, handoff *domain.HandoffPackage) (*domain.HandoffPackage, error) {
	if f.createFn != nil {
		return f.createFn(ctx, handoff)
	}
	now := time.Now().UTC()
	handoff.CreatedAt = now
	handoff.UpdatedAt = now
	return handoff, nil
}

func (f *fakeHandoffStore) GetByCaseID(ctx context.Context, caseID uuid.UUID) (*domain.HandoffPackage, error) {
	if f.getByCaseIDFn != nil {
		return f.getByCaseIDFn(ctx, caseID)
	}
	return nil, nil
}

func (f *fakeHandoffStore) GetByIdempotencyKey(ctx context.Context, key uuid.UUID) (*domain.HandoffPackage, error) {
	if f.getByIdempotencyKeyFn != nil {
		return f.getByIdempotencyKeyFn(ctx, key)
	}
	return nil, nil
}

func (f *fakeHandoffStore) UpdateStatus(context.Context, uuid.UUID, domain.HandoffStatus, *string) error {
	return nil
}

func (f *fakeHandoffStore) CreateIssueMapping(context.Context, *domain.HandoffIssueMapping) (*domain.HandoffIssueMapping, error) {
	return nil, nil
}

func (f *fakeHandoffStore) ListIssueMappings(ctx context.Context, handoffID uuid.UUID) ([]domain.HandoffIssueMapping, error) {
	if f.listIssueMappingsFn != nil {
		return f.listIssueMappingsFn(ctx, handoffID)
	}
	return nil, nil
}

type fakeEstimateStoreForHandoffHandler struct {
	getByIDFn func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error)
}

func (f *fakeEstimateStoreForHandoffHandler) Create(context.Context, *domain.Estimate) (*domain.Estimate, error) {
	return nil, nil
}

func (f *fakeEstimateStoreForHandoffHandler) GetByID(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error) {
	if f.getByIDFn != nil {
		return f.getByIDFn(ctx, tenantID, caseID, estimateID)
	}
	return nil, nil
}

func (f *fakeEstimateStoreForHandoffHandler) ListByCaseID(context.Context, uuid.UUID, uuid.UUID, int, int) ([]domain.Estimate, int, error) {
	return nil, 0, nil
}

func (f *fakeEstimateStoreForHandoffHandler) UpdateThreeWayProposal(context.Context, uuid.UUID, uuid.UUID, json.RawMessage) error {
	return nil
}

func TestHandoffHandlerCreateAccepted(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	estimateID := uuid.New()
	key := uuid.New()

	svc := service.NewHandoffService(&fakeHandoffStore{}, &fakeEstimateStoreForHandoffHandler{
		getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
			return &domain.Estimate{ID: estimateID}, nil
		},
	}, nil)
	handler := NewHandoffHandler(svc)

	mux := http.NewServeMux()
	RegisterHandoffRoutes(mux, handler)

	body := `{"estimate_id":"` + estimateID.String() + `","idempotency_key":"` + key.String() + `"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/handoffs", bytes.NewBufferString(body))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusAccepted, rec.Body.String())
	}
}

func TestHandoffHandlerCreateInvalidIdempotencyKey(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	estimateID := uuid.New()

	svc := service.NewHandoffService(&fakeHandoffStore{}, &fakeEstimateStoreForHandoffHandler{}, nil)
	handler := NewHandoffHandler(svc)
	mux := http.NewServeMux()
	RegisterHandoffRoutes(mux, handler)

	body := `{"estimate_id":"` + estimateID.String() + `","idempotency_key":"bad-key"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/handoffs", bytes.NewBufferString(body))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestHandoffHandlerGetStatus(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	handoffID := uuid.New()
	estimateID := uuid.New()
	issueURL := "https://linear.app/issue"

	svc := service.NewHandoffService(&fakeHandoffStore{
		getByCaseIDFn: func(context.Context, uuid.UUID) (*domain.HandoffPackage, error) {
			return &domain.HandoffPackage{
				ID:         handoffID,
				CaseID:     caseID,
				EstimateID: estimateID,
				Status:     domain.HandoffStatusPending,
				CreatedAt:  time.Now().UTC(),
			}, nil
		},
		listIssueMappingsFn: func(context.Context, uuid.UUID) ([]domain.HandoffIssueMapping, error) {
			return []domain.HandoffIssueMapping{{ModuleName: "billing", LinearIssueURL: &issueURL}}, nil
		},
	}, &fakeEstimateStoreForHandoffHandler{}, nil)
	handler := NewHandoffHandler(svc)

	mux := http.NewServeMux()
	RegisterHandoffRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/handoffs", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body map[string]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	issues, ok := body["data"]["linear_issues"].([]any)
	if !ok || len(issues) != 1 {
		t.Fatalf("linear_issues = %#v, want one item", body["data"]["linear_issues"])
	}
}

func TestHandoffHandlerGetStatusNotFound(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	svc := service.NewHandoffService(&fakeHandoffStore{}, &fakeEstimateStoreForHandoffHandler{}, nil)
	handler := NewHandoffHandler(svc)
	mux := http.NewServeMux()
	RegisterHandoffRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/handoffs", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}
