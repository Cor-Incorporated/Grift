package middleware

import (
	"context"
	"database/sql"
	"fmt"
	"log"
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
	// SetRLS configures a request-scoped transaction with transaction-local RLS.
	SetRLS(ctx context.Context, tenantID string) (*sql.Tx, error)
}

// txKey is the context key for the per-request DB transaction with RLS set.
const txKey contextKey = "db_tx"

// TxFromContext returns the per-request *sql.Tx that has RLS configured.
func TxFromContext(ctx context.Context) *sql.Tx {
	v, _ := ctx.Value(txKey).(*sql.Tx)
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

// SetRLS begins a request-scoped transaction and applies a transaction-local
// tenant setting. Parameterized set_config(..., true) provides SET LOCAL semantics.
func (s *SQLTenantStore) SetRLS(ctx context.Context, tenantID string) (*sql.Tx, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("beginning request transaction: %w", err)
	}

	_, err = tx.ExecContext(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenantID)
	if err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("setting RLS tenant_id: %w", err)
	}

	return tx, nil
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

				tx, err := store.SetRLS(r.Context(), tenantID)
				if err != nil {
					http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
					return
				}

				ctx := context.WithValue(r.Context(), tenantIDKey, tenantID)
				if tx != nil {
					ctx = context.WithValue(ctx, txKey, tx)
				}
				writer := &statusWriter{ResponseWriter: w}
				next.ServeHTTP(writer, r.WithContext(ctx))
				finalizeRequestTx(tx, writer.Status())
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

func finalizeRequestTx(tx *sql.Tx, status int) {
	if tx == nil {
		return
	}
	if status >= http.StatusInternalServerError {
		_ = tx.Rollback()
		return
	}
	if err := tx.Commit(); err != nil {
		log.Printf("tenant middleware: commit failed: %v", err)
		_ = tx.Rollback()
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(data)
}

func (w *statusWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		if w.status == 0 {
			w.status = http.StatusOK
		}
		flusher.Flush()
	}
}

func (w *statusWriter) Status() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}
