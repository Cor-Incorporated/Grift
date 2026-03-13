package handler

import (
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

// parseEvidenceUUID extracts and validates the evidence UUID from the request path.
func parseEvidenceUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	value, err := uuid.Parse(r.PathValue("evidenceId"))
	if err != nil {
		writeJSONError(w, "invalid evidence ID", http.StatusBadRequest)
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

// writeStreamError writes an NDJSON error frame for streaming responses.
func writeStreamError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":  "error",
		"error": err.Error(),
	})
}
