package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	gh "github.com/Cor-Incorporated/BenevolentDirector/services/control-api/internal/github"
	"github.com/Cor-Incorporated/BenevolentDirector/services/control-api/internal/middleware"
	"github.com/google/uuid"
)

// maxLimit is the upper-bound cap for the limit query parameter.
const maxLimit = 100

// RepositoryHandler provides HTTP handlers for repository endpoints.
type RepositoryHandler struct {
	store gh.RepositoryStore
}

// NewRepositoryHandler creates a RepositoryHandler with the given store.
func NewRepositoryHandler(store gh.RepositoryStore) *RepositoryHandler {
	return &RepositoryHandler{store: store}
}

// storeUnavailable returns true and writes a 503 response if the store is nil.
func (h *RepositoryHandler) storeUnavailable(w http.ResponseWriter) bool {
	if h.store == nil {
		writeJSONError(w, "repository store not configured", http.StatusServiceUnavailable)
		return true
	}
	return false
}

// ListRepositories handles GET /v1/repositories.
// Query params: org (optional), limit (default 20, max 100), offset (default 0).
// Response: {"data": [...], "total": N}
func (h *RepositoryHandler) ListRepositories(w http.ResponseWriter, r *http.Request) {
	if h.storeUnavailable(w) {
		return
	}

	tenantID := middleware.TenantIDFromContext(r.Context())
	if tenantID == "" {
		writeJSONError(w, "missing tenant context", http.StatusBadRequest)
		return
	}

	tid, err := uuid.Parse(tenantID)
	if err != nil {
		writeJSONError(w, "invalid tenant ID", http.StatusBadRequest)
		return
	}

	opts := gh.ListOptions{
		Limit:  20,
		Offset: 0,
	}

	if org := r.URL.Query().Get("org"); org != "" {
		opts.OrgName = &org
	}

	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			opts.Limit = v
		}
	}

	// HIGH-2: Cap limit to maxLimit to prevent excessive queries.
	if opts.Limit > maxLimit {
		opts.Limit = maxLimit
	}

	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			opts.Offset = v
		}
	}

	repos, total, err := h.store.ListByTenant(r.Context(), tid, opts)
	if err != nil {
		writeJSONError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	// Ensure non-nil slice for JSON serialization ([] not null).
	data := make([]interface{}, len(repos))
	for i, r := range repos {
		data[i] = r
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data":  data,
		"total": total,
	})
}

// GetRepository handles GET /v1/repositories/{repositoryId}.
// Response: {"data": {...}}
func (h *RepositoryHandler) GetRepository(w http.ResponseWriter, r *http.Request) {
	if h.storeUnavailable(w) {
		return
	}

	tenantID := middleware.TenantIDFromContext(r.Context())
	if tenantID == "" {
		writeJSONError(w, "missing tenant context", http.StatusBadRequest)
		return
	}

	tid, err := uuid.Parse(tenantID)
	if err != nil {
		writeJSONError(w, "invalid tenant ID", http.StatusBadRequest)
		return
	}

	idStr := r.PathValue("repositoryId")
	if idStr == "" {
		writeJSONError(w, "missing repository ID", http.StatusBadRequest)
		return
	}

	id, err := uuid.Parse(idStr)
	if err != nil {
		writeJSONError(w, "invalid repository ID format", http.StatusBadRequest)
		return
	}

	// CRITICAL-2: Pass tenantID to enforce tenant-scoping (prevent IDOR).
	repo, err := h.store.GetByID(r.Context(), id, tid)
	if err != nil {
		writeJSONError(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if repo == nil {
		writeJSONError(w, "repository not found", http.StatusNotFound)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": repo,
	})
}

// discoverRequest is the request body for POST /v1/repositories/discover.
type discoverRequest struct {
	OrgNames []string `json:"org_names"`
}

// DiscoverRepositories handles POST /v1/repositories/discover.
// Accepts {"org_names": [...]} and returns {"job_id": "..."} with 202 Accepted.
func (h *RepositoryHandler) DiscoverRepositories(w http.ResponseWriter, r *http.Request) {
	if h.storeUnavailable(w) {
		return
	}

	tenantID := middleware.TenantIDFromContext(r.Context())
	if tenantID == "" {
		writeJSONError(w, "missing tenant context", http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1024*1024))
	if err != nil {
		writeJSONError(w, "failed to read request body", http.StatusBadRequest)
		return
	}

	var req discoverRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if len(req.OrgNames) == 0 {
		writeJSONError(w, "org_names must not be empty", http.StatusBadRequest)
		return
	}

	// Generate a job ID for the async discovery task.
	// The actual background job execution will be implemented in a future phase.
	jobID := uuid.New()

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"job_id": jobID.String(),
	})
}

// RegisterRepositoryRoutes registers repository routes on the given mux.
// All routes are registered under /v1/repositories/*.
func RegisterRepositoryRoutes(mux *http.ServeMux, h *RepositoryHandler) {
	mux.HandleFunc("GET /v1/repositories", h.ListRepositories)
	mux.HandleFunc("GET /v1/repositories/{repositoryId}", h.GetRepository)
	mux.HandleFunc("POST /v1/repositories/discover", h.DiscoverRepositories)
}

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
