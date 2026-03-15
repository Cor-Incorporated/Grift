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

// mockTenantStore implements store.TenantStore for handler tests.
type mockTenantStore struct {
	createResult *domain.Tenant
	createErr    error

	listResult []domain.Tenant
	listTotal  int
	listErr    error

	getByIDResult *domain.Tenant
	getByIDErr    error

	updateSettingsResult *domain.Tenant
	updateSettingsErr    error

	addMemberResult *domain.TenantMember
	addMemberErr    error

	listMembersResult []domain.TenantMember
	listMembersTotal  int
	listMembersErr    error

	getMemberByFirebaseUIDResult *domain.TenantMember
	getMemberByFirebaseUIDErr    error
}

var _ store.TenantStore = (*mockTenantStore)(nil)

func (m *mockTenantStore) Create(_ context.Context, t *domain.Tenant) (*domain.Tenant, error) {
	if m.createErr != nil {
		return nil, m.createErr
	}
	if m.createResult != nil {
		return m.createResult, nil
	}
	now := time.Now()
	t.CreatedAt = now
	t.UpdatedAt = now
	return t, nil
}

func (m *mockTenantStore) List(_ context.Context, _, _ int) ([]domain.Tenant, int, error) {
	return m.listResult, m.listTotal, m.listErr
}

func (m *mockTenantStore) GetByID(_ context.Context, _ uuid.UUID) (*domain.Tenant, error) {
	return m.getByIDResult, m.getByIDErr
}

func (m *mockTenantStore) UpdateSettings(_ context.Context, _ uuid.UUID, _, _ *bool, _ json.RawMessage) (*domain.Tenant, error) {
	if m.updateSettingsErr != nil {
		return nil, m.updateSettingsErr
	}
	if m.updateSettingsResult != nil {
		return m.updateSettingsResult, nil
	}
	now := time.Now()
	return &domain.Tenant{CreatedAt: now, UpdatedAt: now}, nil
}

func (m *mockTenantStore) AddMember(_ context.Context, mb *domain.TenantMember) (*domain.TenantMember, error) {
	if m.addMemberErr != nil {
		return nil, m.addMemberErr
	}
	if m.addMemberResult != nil {
		return m.addMemberResult, nil
	}
	now := time.Now()
	mb.CreatedAt = now
	mb.UpdatedAt = now
	return mb, nil
}

func (m *mockTenantStore) ListMembers(_ context.Context, _ uuid.UUID, _, _ int) ([]domain.TenantMember, int, error) {
	return m.listMembersResult, m.listMembersTotal, m.listMembersErr
}

func (m *mockTenantStore) GetMemberByFirebaseUID(_ context.Context, _ uuid.UUID, _ string) (*domain.TenantMember, error) {
	return m.getMemberByFirebaseUIDResult, m.getMemberByFirebaseUIDErr
}

func newTestTenantHandler(s store.TenantStore) *TenantHandler {
	svc := service.NewTenantService(s)
	return NewTenantHandler(svc)
}

func TestTenantHandlerCreateTenant(t *testing.T) {
	h := newTestTenantHandler(&mockTenantStore{})
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/tenants",
		bytes.NewBufferString(`{"name":"Acme Corp","slug":"acme-corp"}`))
	rec := httptest.NewRecorder()

	// POST /v1/tenants skips tenant middleware, so we call mux directly.
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var body map[string]map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if body["data"]["name"] != "Acme Corp" {
		t.Fatalf("name = %v, want %q", body["data"]["name"], "Acme Corp")
	}
	if body["data"]["slug"] != "acme-corp" {
		t.Fatalf("slug = %v, want %q", body["data"]["slug"], "acme-corp")
	}
	if body["data"]["plan"] != "free" {
		t.Fatalf("plan = %v, want %q", body["data"]["plan"], "free")
	}
}

func TestTenantHandlerCreateTenant_EmptyName(t *testing.T) {
	h := newTestTenantHandler(&mockTenantStore{})
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/tenants",
		bytes.NewBufferString(`{"name":"","slug":"acme-corp"}`))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestTenantHandlerCreateTenant_InvalidSlug(t *testing.T) {
	h := newTestTenantHandler(&mockTenantStore{})
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/tenants",
		bytes.NewBufferString(`{"name":"Acme","slug":"INVALID SLUG"}`))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestTenantHandlerListTenants(t *testing.T) {
	now := time.Now()

	s := &mockTenantStore{
		listResult: []domain.Tenant{
			{
				ID:        uuid.New(),
				Name:      "Acme Corp",
				Slug:      "acme-corp",
				Plan:      domain.PlanFree,
				Settings:  json.RawMessage(`{}`),
				CreatedAt: now,
				UpdatedAt: now,
			},
		},
		listTotal: 1,
	}

	h := newTestTenantHandler(s)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	req := httptest.NewRequest(http.MethodGet, "/v1/tenants", nil)
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	// Use Auth stub (sets role=admin) + Tenant middleware
	middleware.Chain(middleware.Auth, middleware.Tenant)(mux).ServeHTTP(rec, req)

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

func TestTenantHandlerListTenants_Forbidden(t *testing.T) {
	h := newTestTenantHandler(&mockTenantStore{})
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	req := httptest.NewRequest(http.MethodGet, "/v1/tenants", nil)
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	// No auth middleware — role is empty, should be forbidden.
	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
}

func TestTenantHandlerListTenants_StoreError(t *testing.T) {
	h := newTestTenantHandler(&mockTenantStore{listErr: fmt.Errorf("db connection lost")})
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	req := httptest.NewRequest(http.MethodGet, "/v1/tenants", nil)
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	middleware.Chain(middleware.Auth, middleware.Tenant)(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestTenantHandlerUpdateSettings(t *testing.T) {
	tenantID := uuid.New()
	now := time.Now()

	s := &mockTenantStore{
		getByIDResult: &domain.Tenant{
			ID:        tenantID,
			Name:      "Acme",
			Slug:      "acme",
			Plan:      domain.PlanFree,
			Settings:  json.RawMessage(`{}`),
			CreatedAt: now,
			UpdatedAt: now,
		},
		updateSettingsResult: &domain.Tenant{
			ID:             tenantID,
			Name:           "Acme",
			Slug:           "acme",
			Plan:           domain.PlanFree,
			Settings:       json.RawMessage(`{}`),
			AnalyticsOptIn: true,
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		getMemberByFirebaseUIDResult: &domain.TenantMember{
			ID:          uuid.New(),
			TenantID:    tenantID,
			FirebaseUID: "dev-user",
			Role:        domain.MemberRoleAdmin,
			Active:      true,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	}

	h := newTestTenantHandler(s)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPatch, "/v1/tenants/"+tenantID.String()+"/settings",
		bytes.NewBufferString(`{"analytics_opt_in":true}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	// Auth stub sets user_id=dev-user; mock returns admin member for that UID.
	middleware.Chain(middleware.Auth, middleware.Tenant)(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestTenantHandlerUpdateSettings_Forbidden(t *testing.T) {
	tenantID := uuid.New()
	now := time.Now()

	// Member exists but with viewer role — not admin.
	s := &mockTenantStore{
		getMemberByFirebaseUIDResult: &domain.TenantMember{
			ID:          uuid.New(),
			TenantID:    tenantID,
			FirebaseUID: "dev-user",
			Role:        domain.MemberRoleViewer,
			Active:      true,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	}

	h := newTestTenantHandler(s)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPatch, "/v1/tenants/"+tenantID.String()+"/settings",
		bytes.NewBufferString(`{"analytics_opt_in":true}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Chain(middleware.Auth, middleware.Tenant)(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
}

func TestTenantHandlerUpdateSettings_NotFound(t *testing.T) {
	tenantID := uuid.New()
	now := time.Now()

	s := &mockTenantStore{
		getByIDResult: nil,
		getMemberByFirebaseUIDResult: &domain.TenantMember{
			ID:          uuid.New(),
			TenantID:    tenantID,
			FirebaseUID: "dev-user",
			Role:        domain.MemberRoleOwner,
			Active:      true,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	}

	h := newTestTenantHandler(s)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPatch, "/v1/tenants/"+tenantID.String()+"/settings",
		bytes.NewBufferString(`{"analytics_opt_in":true}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Chain(middleware.Auth, middleware.Tenant)(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestTenantHandlerUpdateSettings_InvalidTenantID(t *testing.T) {
	h := newTestTenantHandler(&mockTenantStore{})
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	req := httptest.NewRequest(http.MethodPatch, "/v1/tenants/not-a-uuid/settings",
		bytes.NewBufferString(`{"analytics_opt_in":true}`))
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestTenantHandlerAddMember(t *testing.T) {
	tenantID := uuid.New()

	s := &mockTenantStore{}
	h := newTestTenantHandler(s)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenantID.String()+"/members",
		bytes.NewBufferString(`{"firebase_uid":"uid-123","role":"member","display_name":"John Doe"}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var body map[string]map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if body["data"]["role"] != "member" {
		t.Fatalf("role = %v, want %q", body["data"]["role"], "member")
	}
}

func TestTenantHandlerAddMember_InvalidRole(t *testing.T) {
	tenantID := uuid.New()

	h := newTestTenantHandler(&mockTenantStore{})
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenantID.String()+"/members",
		bytes.NewBufferString(`{"firebase_uid":"uid-123","role":"superadmin"}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestTenantHandlerAddMember_EmptyFirebaseUID(t *testing.T) {
	tenantID := uuid.New()

	h := newTestTenantHandler(&mockTenantStore{})
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenantID.String()+"/members",
		bytes.NewBufferString(`{"firebase_uid":"","role":"member"}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestTenantHandlerListMembers(t *testing.T) {
	tenantID := uuid.New()
	now := time.Now()

	s := &mockTenantStore{
		listMembersResult: []domain.TenantMember{
			{
				ID:          uuid.New(),
				TenantID:    tenantID,
				FirebaseUID: "uid-1",
				Role:        domain.MemberRoleOwner,
				Active:      true,
				CreatedAt:   now,
				UpdatedAt:   now,
			},
		},
		listMembersTotal: 1,
	}

	h := newTestTenantHandler(s)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+tenantID.String()+"/members", nil)
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
}

func TestTenantHandlerListMembers_StoreError(t *testing.T) {
	tenantID := uuid.New()

	h := newTestTenantHandler(&mockTenantStore{listMembersErr: fmt.Errorf("db error")})
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+tenantID.String()+"/members", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestTenantMiddleware_SkipsPostTenants(t *testing.T) {
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	// Use TenantWithStore(nil) — the no-DB variant that still validates UUID.
	// POST /v1/tenants should skip entirely, so no X-Tenant-ID needed.
	handler := middleware.TenantWithStore(nil)(inner)

	req := httptest.NewRequest(http.MethodPost, "/v1/tenants",
		bytes.NewBufferString(`{"name":"test","slug":"test"}`))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("expected handler to be called for POST /v1/tenants without X-Tenant-ID")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}
