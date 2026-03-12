package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

// mockCaseStore implements store.CaseStore for handler tests.
type mockCaseStore struct {
	createResult *domain.Case
	createErr    error

	listResult []domain.Case
	listTotal  int
	listErr    error

	getResult *domain.Case
	getErr    error
}

var _ store.CaseStore = (*mockCaseStore)(nil)

func (m *mockCaseStore) Create(_ context.Context, c *domain.Case) (*domain.Case, error) {
	if m.createErr != nil {
		return nil, m.createErr
	}
	if m.createResult != nil {
		return m.createResult, nil
	}
	// Return the input with timestamps populated.
	now := time.Now()
	c.CreatedAt = now
	c.UpdatedAt = now
	return c, nil
}

func (m *mockCaseStore) List(_ context.Context, _ uuid.UUID, _, _ string, _, _ int) ([]domain.Case, int, error) {
	return m.listResult, m.listTotal, m.listErr
}

func (m *mockCaseStore) Get(_ context.Context, _ uuid.UUID, _ uuid.UUID) (*domain.Case, error) {
	return m.getResult, m.getErr
}

func newTestCaseHandler(s store.CaseStore) *CaseHandler {
	svc := service.NewCaseService(s)
	return NewCaseHandler(svc)
}

func TestCaseHandlerCreateCase(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	h := newTestCaseHandler(&mockCaseStore{})
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases",
		bytes.NewBufferString(`{"title":"New intake","type":"new_project"}`))
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var body map[string]map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if body["data"]["title"] != "New intake" {
		t.Fatalf("title = %v, want %q", body["data"]["title"], "New intake")
	}
}

func TestCaseHandlerCreateCase_InvalidType(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	h := newTestCaseHandler(&mockCaseStore{})
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases",
		bytes.NewBufferString(`{"title":"Bad type","type":"invalid_type"}`))
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestCaseHandlerCreateCase_EmptyTitle(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	h := newTestCaseHandler(&mockCaseStore{})
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases",
		bytes.NewBufferString(`{"title":"","type":"new_project"}`))
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestCaseHandlerListCases(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	now := time.Now()

	s := &mockCaseStore{
		listResult: []domain.Case{
			{
				ID:       uuid.New(),
				TenantID: tenantID,
				Title:    "List item",
				Type:     domain.CaseTypeNewProject,
				Status:   domain.CaseStatusDraft,
				CreatedAt: now,
				UpdatedAt: now,
			},
		},
		listTotal: 1,
	}

	h := newTestCaseHandler(s)
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body struct {
		Data  []map[string]any `json:"data"`
		Total float64          `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if len(body.Data) != 1 {
		t.Fatalf("len(data) = %d, want 1", len(body.Data))
	}
	if body.Total != 1 {
		t.Fatalf("total = %v, want 1", body.Total)
	}
}

func TestCaseHandlerListCases_StoreError(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	h := newTestCaseHandler(&mockCaseStore{listErr: fmt.Errorf("db connection lost")})
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestCaseHandlerGetCase_Found(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	now := time.Now()

	s := &mockCaseStore{
		getResult: &domain.Case{
			ID:        caseID,
			TenantID:  tenantID,
			Title:     "Found case",
			Type:      domain.CaseTypeNewProject,
			Status:    domain.CaseStatusDraft,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}

	h := newTestCaseHandler(s)
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String(), nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body map[string]map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if body["data"]["title"] != "Found case" {
		t.Fatalf("title = %v, want %q", body["data"]["title"], "Found case")
	}
}

func TestCaseHandlerGetCase_NotFound(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	h := newTestCaseHandler(&mockCaseStore{getResult: nil})
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	caseID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String(), nil)
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestCaseHandlerGetCase_InvalidID(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	h := newTestCaseHandler(&mockCaseStore{})
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/not-a-uuid", nil)
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
