package middleware

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
)

type contextKey string

const tenantIDKey contextKey = "tenant_id"

var uuidRegex = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
)

// TenantStore provides tenant lookup and RLS configuration capabilities.
// Implementations must be safe for concurrent use.
type TenantStore interface {
	// Exists reports whether a tenant with the given ID exists.
	Exists(ctx context.Context, tenantID string) (bool, error)
	// SetRLS executes SET app.current_tenant_id on the database connection
	// to enable row-level security filtering.
	SetRLS(ctx context.Context, tenantID string) error
}

// SQLTenantStore implements TenantStore using a *sql.DB connection.
type SQLTenantStore struct {
	DB *sql.DB
}

// Exists checks whether a tenant with the given ID exists in the tenants table.
func (s *SQLTenantStore) Exists(ctx context.Context, tenantID string) (bool, error) {
	var exists bool
	err := s.DB.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM tenants WHERE id = $1)", tenantID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("checking tenant existence: %w", err)
	}
	return exists, nil
}

// SetRLS sets the app.current_tenant_id session variable for row-level security.
func (s *SQLTenantStore) SetRLS(ctx context.Context, tenantID string) error {
	_, err := s.DB.ExecContext(ctx,
		fmt.Sprintf("SET app.current_tenant_id = '%s'", tenantID),
	)
	if err != nil {
		return fmt.Errorf("setting RLS tenant_id: %w", err)
	}
	return nil
}

// TenantIDFromContext returns the tenant ID stored in the request context.
func TenantIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(tenantIDKey).(string)
	return v
}

// TenantWithStore creates a tenant middleware that validates the X-Tenant-ID
// header, verifies the tenant exists, and sets the RLS session variable.
// If store is nil, only UUID format validation is performed.
func TenantWithStore(store TenantStore) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/healthz" {
				next.ServeHTTP(w, r)
				return
			}

			tenantID := r.Header.Get("X-Tenant-ID")
			if tenantID == "" {
				http.Error(w, `{"error":"missing X-Tenant-ID header"}`, http.StatusBadRequest)
				return
			}

			if !uuidRegex.MatchString(tenantID) {
				http.Error(w, `{"error":"invalid X-Tenant-ID format"}`, http.StatusBadRequest)
				return
			}

			if store != nil {
				exists, err := store.Exists(r.Context(), tenantID)
				if err != nil {
					http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
					return
				}
				if !exists {
					http.Error(w, `{"error":"tenant not found"}`, http.StatusNotFound)
					return
				}

				if err := store.SetRLS(r.Context(), tenantID); err != nil {
					http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
					return
				}
			}

			ctx := context.WithValue(r.Context(), tenantIDKey, tenantID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// Tenant extracts X-Tenant-ID from the request header, validates its UUID
// format, and stores it in the request context. Returns 400 if the header
// is missing or invalid. This is the no-DB variant for backward compatibility.
func Tenant(next http.Handler) http.Handler {
	return TenantWithStore(nil)(next)
}
