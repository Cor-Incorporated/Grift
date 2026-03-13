package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

type fakeEstimateStore struct {
	createFn     func(ctx context.Context, e *domain.Estimate) (*domain.Estimate, error)
	getByIDFn    func(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error)
	listByCaseFn func(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error)
	updateTWPFn  func(ctx context.Context, tenantID, estimateID uuid.UUID, proposal json.RawMessage) error
}

func (f *fakeEstimateStore) Create(ctx context.Context, e *domain.Estimate) (*domain.Estimate, error) {
	if f.createFn != nil {
		return f.createFn(ctx, e)
	}
	now := time.Now()
	e.CreatedAt = now
	e.UpdatedAt = now
	return e, nil
}

func (f *fakeEstimateStore) GetByID(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error) {
	if f.getByIDFn != nil {
		return f.getByIDFn(ctx, tenantID, caseID, estimateID)
	}
	return nil, nil
}

func (f *fakeEstimateStore) ListByCaseID(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error) {
	if f.listByCaseFn != nil {
		return f.listByCaseFn(ctx, tenantID, caseID, limit, offset)
	}
	return nil, 0, nil
}

func (f *fakeEstimateStore) UpdateThreeWayProposal(ctx context.Context, tenantID, estimateID uuid.UUID, proposal json.RawMessage) error {
	if f.updateTWPFn != nil {
		return f.updateTWPFn(ctx, tenantID, estimateID, proposal)
	}
	return nil
}

func TestEstimateHandlerCreate(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	svc := service.NewEstimateService(&fakeEstimateStore{}, nil)
	handler := NewEstimateHandler(svc)

	mux := http.NewServeMux()
	RegisterEstimateRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/estimates", bytes.NewBufferString(`{
		"your_hourly_rate": 15000,
		"region": "japan",
		"include_market_evidence": true
	}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var body map[string]json.RawMessage
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if _, ok := body["data"]; !ok {
		t.Fatal("response missing 'data' field")
	}
}

func TestEstimateHandlerCreateValidationErrors(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{
			name:       "invalid JSON",
			body:       `{invalid`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "zero rate",
			body:       `{"your_hourly_rate": 0}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "negative rate",
			body:       `{"your_hourly_rate": -100}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing rate",
			body:       `{}`,
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := service.NewEstimateService(&fakeEstimateStore{}, nil)
			handler := NewEstimateHandler(svc)
			mux := http.NewServeMux()
			RegisterEstimateRoutes(mux, handler)

			req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/estimates", bytes.NewBufferString(tt.body))
			req.Header.Set("X-Tenant-ID", tenantID.String())
			rec := httptest.NewRecorder()

			middleware.Tenant(mux).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestEstimateHandlerList(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	estimateID := uuid.New()

	store := &fakeEstimateStore{
		listByCaseFn: func(_ context.Context, _, _ uuid.UUID, _, _ int) ([]domain.Estimate, int, error) {
			return []domain.Estimate{{ID: estimateID, RiskFlags: []string{}}}, 1, nil
		},
	}
	svc := service.NewEstimateService(store, nil)
	handler := NewEstimateHandler(svc)

	mux := http.NewServeMux()
	RegisterEstimateRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/estimates?limit=10&offset=0", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if body["total"] != float64(1) {
		t.Fatalf("total = %v, want 1", body["total"])
	}
}

func TestEstimateHandlerGetByID(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	estimateID := uuid.New()

	store := &fakeEstimateStore{
		getByIDFn: func(_ context.Context, _, _, gotEstimateID uuid.UUID) (*domain.Estimate, error) {
			if gotEstimateID != estimateID {
				t.Fatalf("unexpected estimateID: %s", gotEstimateID)
			}
			return &domain.Estimate{
				ID:        estimateID,
				RiskFlags: []string{},
			}, nil
		},
	}
	svc := service.NewEstimateService(store, nil)
	handler := NewEstimateHandler(svc)

	mux := http.NewServeMux()
	RegisterEstimateRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/estimates/"+estimateID.String(), nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestEstimateHandlerGetByIDErrors(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	tests := []struct {
		name       string
		path       string
		store      *fakeEstimateStore
		wantStatus int
	}{
		{
			name:       "invalid estimate id",
			path:       "/v1/cases/" + caseID.String() + "/estimates/bad-id",
			store:      &fakeEstimateStore{},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "not found",
			path: "/v1/cases/" + caseID.String() + "/estimates/" + uuid.New().String(),
			store: &fakeEstimateStore{
				getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
					return nil, nil
				},
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "store error",
			path: "/v1/cases/" + caseID.String() + "/estimates/" + uuid.New().String(),
			store: &fakeEstimateStore{
				getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
					return nil, errors.New("db timeout")
				},
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := service.NewEstimateService(tt.store, nil)
			handler := NewEstimateHandler(svc)
			mux := http.NewServeMux()
			RegisterEstimateRoutes(mux, handler)

			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			req.Header.Set("X-Tenant-ID", tenantID.String())
			rec := httptest.NewRecorder()

			middleware.Tenant(mux).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestEstimateHandlerGetThreeWayProposal(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	estimateID := uuid.New()

	store := &fakeEstimateStore{
		getByIDFn: func(_ context.Context, _, _, _ uuid.UUID) (*domain.Estimate, error) {
			return &domain.Estimate{
				ID:               estimateID,
				ThreeWayProposal: json.RawMessage(`{"option_a":{"label":"Budget"}}`),
				RiskFlags:        []string{},
			}, nil
		},
	}
	svc := service.NewEstimateService(store, nil)
	handler := NewEstimateHandler(svc)

	mux := http.NewServeMux()
	RegisterEstimateRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/estimates/"+estimateID.String()+"/three-way-proposal", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestEstimateHandlerGetThreeWayProposalNotFound(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	estimateID := uuid.New()

	store := &fakeEstimateStore{
		getByIDFn: func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (*domain.Estimate, error) {
			return nil, nil
		},
	}
	svc := service.NewEstimateService(store, nil)
	handler := NewEstimateHandler(svc)

	mux := http.NewServeMux()
	RegisterEstimateRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/estimates/"+estimateID.String()+"/three-way-proposal", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestEstimateHandlerMissingTenant(t *testing.T) {
	svc := service.NewEstimateService(&fakeEstimateStore{}, nil)
	handler := NewEstimateHandler(svc)

	mux := http.NewServeMux()
	RegisterEstimateRoutes(mux, handler)

	caseID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/estimates", nil)
	// No X-Tenant-ID header and no middleware wrapping
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestEstimateHandlerInvalidCaseID(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")

	svc := service.NewEstimateService(&fakeEstimateStore{}, nil)
	handler := NewEstimateHandler(svc)

	mux := http.NewServeMux()
	RegisterEstimateRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/bad-id/estimates", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
