package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeTenantStore is a test double for TenantStore.
type fakeTenantStore struct {
	tenants    map[string]bool
	rlsCalls   []string
	existsErr  error
	setRLSErr  error
}

func (f *fakeTenantStore) Exists(_ context.Context, tenantID string) (bool, error) {
	if f.existsErr != nil {
		return false, f.existsErr
	}
	return f.tenants[tenantID], nil
}

func (f *fakeTenantStore) SetRLS(_ context.Context, tenantID string) error {
	if f.setRLSErr != nil {
		return f.setRLSErr
	}
	f.rlsCalls = append(f.rlsCalls, tenantID)
	return nil
}

func TestTenantMiddleware_MissingHeader(t *testing.T) {
	handler := Tenant(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestTenantMiddleware_InvalidUUID(t *testing.T) {
	handler := Tenant(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("X-Tenant-ID", "not-a-uuid")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestTenantMiddleware_ValidUUID_NoStore(t *testing.T) {
	var gotTenantID string
	handler := Tenant(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTenantID = TenantIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if gotTenantID != tenantID {
		t.Errorf("TenantIDFromContext() = %q, want %q", gotTenantID, tenantID)
	}
}

func TestTenantMiddleware_HealthzSkipsTenantCheck(t *testing.T) {
	handler := Tenant(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestTenantWithStore_ValidTenantSetsRLS(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	store := &fakeTenantStore{
		tenants: map[string]bool{tenantID: true},
	}

	var gotTenantID string
	handler := TenantWithStore(store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTenantID = TenantIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if gotTenantID != tenantID {
		t.Errorf("TenantIDFromContext() = %q, want %q", gotTenantID, tenantID)
	}
	if len(store.rlsCalls) != 1 || store.rlsCalls[0] != tenantID {
		t.Errorf("SetRLS calls = %v, want [%s]", store.rlsCalls, tenantID)
	}
}

func TestTenantWithStore_TenantNotFound(t *testing.T) {
	store := &fakeTenantStore{
		tenants: map[string]bool{},
	}

	handler := TenantWithStore(store)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("X-Tenant-ID", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestTenantWithStore_ExistsError(t *testing.T) {
	store := &fakeTenantStore{
		existsErr: fmt.Errorf("db connection failed"),
	}

	handler := TenantWithStore(store)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("X-Tenant-ID", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestTenantWithStore_SetRLSError(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	store := &fakeTenantStore{
		tenants:   map[string]bool{tenantID: true},
		setRLSErr: fmt.Errorf("SET failed"),
	}

	handler := TenantWithStore(store)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestTenantWithStore_HealthzSkips(t *testing.T) {
	store := &fakeTenantStore{
		tenants: map[string]bool{},
	}

	handler := TenantWithStore(store)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(store.rlsCalls) != 0 {
		t.Errorf("SetRLS should not be called for healthz, got %v", store.rlsCalls)
	}
}
