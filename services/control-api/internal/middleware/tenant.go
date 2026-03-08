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
	// SetRLS configures the app.tenant_id session variable on a dedicated
	// connection for row-level security filtering. The returned *sql.Conn
	// must be used for all subsequent queries in the request and closed when done.
	SetRLS(ctx context.Context, tenantID string) (*sql.Conn, error)
}

// connKey is the context key for the per-request DB connection with RLS set.
const connKey contextKey = "db_conn"

// ConnFromContext returns the per-request *sql.Conn that has RLS configured.
func ConnFromContext(ctx context.Context) *sql.Conn {
	v, _ := ctx.Value(connKey).(*sql.Conn)
	return v
}

// SQLTenantStore implements TenantStore using a *sql.DB connection pool.
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

// SetRLS acquires a dedicated connection from the pool, sets app.tenant_id
// using parameterized set_config (no SQL injection risk), and returns the
// connection for use in the request scope. Caller must close the connection.
func (s *SQLTenantStore) SetRLS(ctx context.Context, tenantID string) (*sql.Conn, error) {
	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquiring connection: %w", err)
	}
	_, err = conn.ExecContext(ctx,
		"SELECT set_config('app.tenant_id', $1, false)", tenantID,
	)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("setting RLS tenant_id: %w", err)
	}
	return conn, nil
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

				conn, err := store.SetRLS(r.Context(), tenantID)
				if err != nil {
					http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
					return
				}
				if conn != nil {
					defer conn.Close()
				}

				ctx := context.WithValue(r.Context(), tenantIDKey, tenantID)
				if conn != nil {
					ctx = context.WithValue(ctx, connKey, conn)
				}
				next.ServeHTTP(w, r.WithContext(ctx))
				return
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
