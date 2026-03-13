package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/marketevent"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

type fakeMarketEvidenceStore struct {
	getByIDFunc func(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error)
}

func (f *fakeMarketEvidenceStore) GetByID(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error) {
	if f.getByIDFunc != nil {
		return f.getByIDFunc(ctx, tenantID, evidenceID)
	}
	return nil, nil
}

type fakeMarketMessagePublisher struct {
	err error
}

func (f *fakeMarketMessagePublisher) Publish(_ context.Context, _ string, _ string, _ []byte) error {
	return f.err
}

func TestMarketEvidenceHandlerCollect(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	publisher := &fakeMarketMessagePublisher{}
	svc := service.NewMarketEvidenceService(
		&fakeMarketEvidenceStore{},
		marketevent.NewPublisher(publisher, "market-topic"),
	)
	handler := NewMarketEvidenceHandler(svc)

	mux := http.NewServeMux()
	RegisterMarketEvidenceRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/market-evidence", bytes.NewBufferString(`{
		"case_type":"new_project",
		"context":"Build a procurement workflow portal",
		"providers":["grok","gemini"]
	}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusAccepted, rec.Body.String())
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if _, err := uuid.Parse(body["job_id"]); err != nil {
		t.Fatalf("job_id = %q, want valid uuid", body["job_id"])
	}
}

func TestMarketEvidenceHandlerCollectValidationError(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	svc := service.NewMarketEvidenceService(
		&fakeMarketEvidenceStore{},
		marketevent.NewPublisher(&fakeMarketMessagePublisher{}, "market-topic"),
	)
	handler := NewMarketEvidenceHandler(svc)

	mux := http.NewServeMux()
	RegisterMarketEvidenceRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/market-evidence", bytes.NewBufferString(`{
		"case_type":"invalid",
		"context":"Build a procurement workflow portal"
	}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if body["error"] != "invalid request" {
		t.Fatalf("error = %q, want %q", body["error"], "invalid request")
	}
}

func TestMarketEvidenceHandlerGet(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	evidenceID := uuid.New()
	store := &fakeMarketEvidenceStore{
		getByIDFunc: func(_ context.Context, gotTenantID, gotEvidenceID uuid.UUID) (*domain.AggregatedEvidence, error) {
			if gotTenantID != tenantID || gotEvidenceID != evidenceID {
				t.Fatalf("unexpected ids: %s %s", gotTenantID, gotEvidenceID)
			}
			return &domain.AggregatedEvidence{
				ID:                evidenceID,
				OverallConfidence: "medium",
			}, nil
		},
	}
	handler := NewMarketEvidenceHandler(service.NewMarketEvidenceService(store, nil))

	mux := http.NewServeMux()
	RegisterMarketEvidenceRoutes(mux, handler)

	req := httptest.NewRequest(http.MethodGet, "/v1/market-evidence/"+evidenceID.String(), nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestMarketEvidenceHandlerGetErrors(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")

	tests := []struct {
		name       string
		path       string
		store      *fakeMarketEvidenceStore
		wantStatus int
	}{
		{
			name:       "invalid evidence id",
			path:       "/v1/market-evidence/bad-id",
			store:      &fakeMarketEvidenceStore{},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "not found",
			path: "/v1/market-evidence/" + uuid.New().String(),
			store: &fakeMarketEvidenceStore{
				getByIDFunc: func(context.Context, uuid.UUID, uuid.UUID) (*domain.AggregatedEvidence, error) {
					return nil, nil
				},
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "store error",
			path: "/v1/market-evidence/" + uuid.New().String(),
			store: &fakeMarketEvidenceStore{
				getByIDFunc: func(context.Context, uuid.UUID, uuid.UUID) (*domain.AggregatedEvidence, error) {
					return nil, errors.New("db timeout")
				},
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := NewMarketEvidenceHandler(service.NewMarketEvidenceService(tt.store, nil))
			mux := http.NewServeMux()
			RegisterMarketEvidenceRoutes(mux, handler)

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
