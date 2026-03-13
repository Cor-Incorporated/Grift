package handler

import (
	"log/slog"
	"net/http"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
)

// CompletenessHandler serves completeness feedback-loop snapshots.
type CompletenessHandler struct {
	store store.CompletenessStore
}

// NewCompletenessHandler creates a CompletenessHandler with the given store.
func NewCompletenessHandler(s store.CompletenessStore) *CompletenessHandler {
	if s == nil {
		panic("completeness store must not be nil")
	}
	return &CompletenessHandler{store: s}
}

// RegisterCompletenessRoutes registers completeness observation routes.
func RegisterCompletenessRoutes(mux *http.ServeMux, h *CompletenessHandler) {
	mux.HandleFunc("GET /v1/cases/{caseId}/observation/completeness", h.GetByCaseID)
}

// GetByCaseID handles GET /v1/cases/{caseId}/observation/completeness.
func (h *CompletenessHandler) GetByCaseID(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	observation, err := h.store.GetByCaseID(r.Context(), tenantID, caseID)
	if err != nil {
		slog.Error("completeness store error", "error", err, "tenant_id", tenantID.String(), "case_id", caseID.String())
		writeJSON(w, http.StatusInternalServerError, errorBody("internal server error"))
		return
	}
	if observation == nil {
		writeJSON(w, http.StatusNotFound, errorBody("completeness observation not found"))
		return
	}

	writeJSON(w, http.StatusOK, observation)
}
