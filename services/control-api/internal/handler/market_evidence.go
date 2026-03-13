package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

// MarketEvidenceHandler serves market evidence endpoints.
type MarketEvidenceHandler struct {
	svc *service.MarketEvidenceService
}

// NewMarketEvidenceHandler creates a MarketEvidenceHandler.
func NewMarketEvidenceHandler(svc *service.MarketEvidenceService) *MarketEvidenceHandler {
	if svc == nil {
		panic("market evidence service must not be nil")
	}
	return &MarketEvidenceHandler{svc: svc}
}

// RegisterMarketEvidenceRoutes registers market evidence routes.
func RegisterMarketEvidenceRoutes(mux *http.ServeMux, h *MarketEvidenceHandler) {
	mux.HandleFunc("POST /v1/market-evidence", h.Collect)
	mux.HandleFunc("GET /v1/market-evidence/{evidenceId}", h.GetByID)
}

// Collect handles POST /v1/market-evidence.
func (h *MarketEvidenceHandler) Collect(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}

	var req collectMarketEvidenceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	evidenceID := uuid.New()
	var caseID *uuid.UUID
	if req.CaseID != nil {
		parsedCaseID, err := uuid.Parse(*req.CaseID)
		if err != nil {
			writeJSONError(w, "invalid case ID", http.StatusBadRequest)
			return
		}
		caseID = &parsedCaseID
	}

	err := h.svc.QueueCollection(r.Context(), service.CollectMarketEvidenceInput{
		TenantID:   tenantID,
		EvidenceID: evidenceID,
		CaseID:     caseID,
		CaseType:   domain.CaseType(req.CaseType),
		Context:    req.Context,
		Region:     req.Region,
		Providers:  req.Providers,
	})
	if err != nil {
		switch {
		case errors.Is(err, service.ErrPublisherUnavailable):
			writeJSONError(w, "market research queue unavailable", http.StatusServiceUnavailable)
		default:
			writeJSONError(w, "invalid request", http.StatusBadRequest)
		}
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"job_id": evidenceID.String()})
}

// GetByID handles GET /v1/market-evidence/{evidenceId}.
func (h *MarketEvidenceHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	evidenceID, ok := parseEvidenceUUID(w, r)
	if !ok {
		return
	}

	record, err := h.svc.GetByID(r.Context(), tenantID, evidenceID)
	if err != nil {
		writeJSONError(w, "failed to get market evidence", http.StatusInternalServerError)
		return
	}
	if record == nil {
		writeJSONError(w, "market evidence not found", http.StatusNotFound)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": record})
}

type collectMarketEvidenceRequest struct {
	CaseID    *string  `json:"case_id"`
	CaseType  string   `json:"case_type"`
	Context   string   `json:"context"`
	Region    string   `json:"region"`
	Providers []string `json:"providers"`
}
