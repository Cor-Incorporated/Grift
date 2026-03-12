package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/google/uuid"
)

// maxLimit is the upper-bound cap for the limit query parameter.
const maxLimit = 100

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeJSONError writes a JSON error response.
func writeJSONError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// errorBody creates a simple error response body.
func errorBody(msg string) map[string]string {
	return map[string]string{"error": msg}
}

// rowScanner abstracts *sql.Row and *sql.Rows for scanning.
type rowScanner interface {
	Scan(dest ...any) error
}

// dbExecutor abstracts *sql.DB and *sql.Tx for query execution.
type dbExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// dbExecutorFromContext returns the active transaction from context, or falls back to db.
func dbExecutorFromContext(ctx context.Context, db *sql.DB) dbExecutor {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return db
}

// parseTenantUUID extracts and validates the tenant UUID from request context.
func parseTenantUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := middleware.TenantIDFromContext(r.Context())
	if raw == "" {
		writeJSONError(w, "missing tenant context", http.StatusBadRequest)
		return uuid.Nil, false
	}
	value, err := uuid.Parse(raw)
	if err != nil {
		writeJSONError(w, "invalid tenant ID", http.StatusBadRequest)
		return uuid.Nil, false
	}
	return value, true
}

// parseCaseUUID extracts and validates the case UUID from the request path.
func parseCaseUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	value, err := uuid.Parse(r.PathValue("caseId"))
	if err != nil {
		writeJSONError(w, "invalid case ID", http.StatusBadRequest)
		return uuid.Nil, false
	}
	return value, true
}

// parsePagination extracts limit and offset query parameters with defaults.
func parsePagination(r *http.Request) (int, int) {
	limit := 20
	offset := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= maxLimit {
			limit = parsed
		}
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			offset = parsed
		}
	}
	return limit, offset
}

// nilIfBlank returns nil for blank strings, or a pointer to the trimmed value.
func nilIfBlank(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// statusError is an error that carries an HTTP status code.
type statusError struct {
	status int
	msg    string
}

func (e statusError) Error() string {
	return e.msg
}

// errWithStatus creates a statusError with the given message and HTTP status.
func errWithStatus(msg string, status int) error {
	return statusError{status: status, msg: msg}
}

// httpStatusForError extracts the HTTP status from a statusError, defaulting to 500.
func httpStatusForError(err error) int {
	if typed, ok := err.(statusError); ok {
		return typed.status
	}
	return http.StatusInternalServerError
}

// writeStreamError writes an NDJSON error frame for streaming responses.
func writeStreamError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":  "error",
		"error": err.Error(),
	})
}
