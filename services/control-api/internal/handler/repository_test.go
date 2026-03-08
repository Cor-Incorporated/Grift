package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Cor-Incorporated/BenevolentDirector/services/control-api/internal/domain"
	gh "github.com/Cor-Incorporated/BenevolentDirector/services/control-api/internal/github"
	"github.com/Cor-Incorporated/BenevolentDirector/services/control-api/internal/middleware"
	"github.com/google/uuid"
)

// mockRepositoryStore is a test double for github.RepositoryStore.
type mockRepositoryStore struct {
	repos       []domain.Repository
	total       int
	getResult   *domain.Repository
	listErr     error
	getErr      error
	upsertErr   error
	findNewIDs  []int64
	findArchIDs []uuid.UUID
	findErr     error
}

func (m *mockRepositoryStore) UpsertRepository(_ context.Context, _ *domain.Repository) error {
	return m.upsertErr
}

func (m *mockRepositoryStore) ListByTenant(_ context.Context, _ uuid.UUID, _ gh.ListOptions) ([]domain.Repository, int, error) {
	return m.repos, m.total, m.listErr
}

func (m *mockRepositoryStore) GetByID(_ context.Context, _ uuid.UUID, _ uuid.UUID) (*domain.Repository, error) {
	return m.getResult, m.getErr
}

func (m *mockRepositoryStore) FindNewAndArchived(_ context.Context, _ uuid.UUID, _ []int64) ([]int64, []uuid.UUID, error) {
	return m.findNewIDs, m.findArchIDs, m.findErr
}

// withTenant wraps a request with the tenant ID in context (simulating the tenant middleware).
func withTenant(r *http.Request, tenantID string) *http.Request {
	// Use the real middleware's context key by going through TenantIDFromContext's inverse.
	// We set it via the Tenant middleware by adding the header.
	r.Header.Set("X-Tenant-ID", tenantID)

	// Apply the stub tenant middleware to inject the context value.
	var captured *http.Request
	handler := middleware.Tenant(http.HandlerFunc(func(_ http.ResponseWriter, req *http.Request) {
		captured = req
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, r)
	if captured == nil {
		return r
	}
	return captured
}

func TestListRepositories_Success(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	now := time.Now().Truncate(time.Second)
	orgName := "myorg"
	repos := []domain.Repository{
		{
			ID:       uuid.New(),
			TenantID: tenantID,
			OrgName:  &orgName,
			RepoName: "repo1",
			FullName: "myorg/repo1",
			Stars:    42,
			Topics:   []string{"go"},
			TechStack: []string{"Go"},
			CreatedAt: now,
			UpdatedAt: now,
		},
	}

	store := &mockRepositoryStore{repos: repos, total: 1}
	h := NewRepositoryHandler(store)

	req := httptest.NewRequest(http.MethodGet, "/v1/repositories?org=myorg&limit=10&offset=0", nil)
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	h.ListRepositories(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var resp map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if _, ok := resp["data"]; !ok {
		t.Error("response missing 'data' field")
	}
	if _, ok := resp["total"]; !ok {
		t.Error("response missing 'total' field")
	}

	var total int
	if err := json.Unmarshal(resp["total"], &total); err != nil {
		t.Fatalf("decoding total: %v", err)
	}
	if total != 1 {
		t.Errorf("total = %d, want 1", total)
	}
}

func TestListRepositories_StoreError(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	store := &mockRepositoryStore{listErr: fmt.Errorf("db connection lost")}
	h := NewRepositoryHandler(store)

	req := httptest.NewRequest(http.MethodGet, "/v1/repositories", nil)
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	h.ListRepositories(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestListRepositories_NilStore(t *testing.T) {
	h := NewRepositoryHandler(nil)

	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	req := httptest.NewRequest(http.MethodGet, "/v1/repositories", nil)
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	h.ListRepositories(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
}

func TestGetRepository_Found(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	repoID := uuid.New()
	now := time.Now().Truncate(time.Second)

	orgName := "myorg"
	store := &mockRepositoryStore{
		getResult: &domain.Repository{
			ID:        repoID,
			TenantID:  tenantID,
			OrgName:   &orgName,
			RepoName:  "repo1",
			FullName:  "myorg/repo1",
			Stars:     10,
			Topics:    []string{},
			TechStack: []string{},
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
	h := NewRepositoryHandler(store)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/repositories/{repositoryId}", h.GetRepository)

	req := httptest.NewRequest(http.MethodGet, "/v1/repositories/"+repoID.String(), nil)
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var resp map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if _, ok := resp["data"]; !ok {
		t.Error("response missing 'data' field")
	}
}

func TestGetRepository_NotFound(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	store := &mockRepositoryStore{getResult: nil}
	h := NewRepositoryHandler(store)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/repositories/{repositoryId}", h.GetRepository)

	repoID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/v1/repositories/"+repoID.String(), nil)
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestGetRepository_InvalidID(t *testing.T) {
	store := &mockRepositoryStore{}
	h := NewRepositoryHandler(store)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/repositories/{repositoryId}", h.GetRepository)

	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	req := httptest.NewRequest(http.MethodGet, "/v1/repositories/not-a-uuid", nil)
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestGetRepository_NilStore(t *testing.T) {
	h := NewRepositoryHandler(nil)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/repositories/{repositoryId}", h.GetRepository)

	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	repoID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/v1/repositories/"+repoID.String(), nil)
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
}

func TestDiscoverRepositories_Success(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	store := &mockRepositoryStore{}
	h := NewRepositoryHandler(store)

	body := `{"org_names":["myorg","another-org"]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/repositories/discover", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	h.DiscoverRepositories(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusAccepted)
	}

	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}

	jobID := resp["job_id"]
	if jobID == "" {
		t.Error("response missing 'job_id' field")
	}

	if _, err := uuid.Parse(jobID); err != nil {
		t.Errorf("job_id is not a valid UUID: %v", err)
	}
}

func TestDiscoverRepositories_EmptyOrgNames(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	store := &mockRepositoryStore{}
	h := NewRepositoryHandler(store)

	body := `{"org_names":[]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/repositories/discover", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	h.DiscoverRepositories(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestDiscoverRepositories_InvalidJSON(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	store := &mockRepositoryStore{}
	h := NewRepositoryHandler(store)

	body := `not json`
	req := httptest.NewRequest(http.MethodPost, "/v1/repositories/discover", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	h.DiscoverRepositories(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestDiscoverRepositories_MissingTenant(t *testing.T) {
	store := &mockRepositoryStore{}
	h := NewRepositoryHandler(store)

	body := `{"org_names":["org1"]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/repositories/discover", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// No tenant middleware applied.

	rec := httptest.NewRecorder()
	h.DiscoverRepositories(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestDiscoverRepositories_NilStore(t *testing.T) {
	h := NewRepositoryHandler(nil)

	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	body := `{"org_names":["org1"]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/repositories/discover", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withTenant(req, tenantID.String())

	rec := httptest.NewRecorder()
	h.DiscoverRepositories(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
}
