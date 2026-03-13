package handler

import (
	"encoding/json"
	"net/http"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

// EstimateHandler serves estimate endpoints.
type EstimateHandler struct {
	svc *service.EstimateService
}

// NewEstimateHandler creates an EstimateHandler.
func NewEstimateHandler(svc *service.EstimateService) *EstimateHandler {
	if svc == nil {
		panic("estimate service must not be nil")
	}
	return &EstimateHandler{svc: svc}
}

// RegisterEstimateRoutes registers estimate routes on the given mux.
func RegisterEstimateRoutes(mux *http.ServeMux, h *EstimateHandler) {
	mux.HandleFunc("POST /v1/cases/{caseId}/estimates", h.Create)
	mux.HandleFunc("GET /v1/cases/{caseId}/estimates", h.List)
	mux.HandleFunc("GET /v1/cases/{caseId}/estimates/{estimateId}", h.GetByID)
	mux.HandleFunc("GET /v1/cases/{caseId}/estimates/{estimateId}/three-way-proposal", h.GetThreeWayProposal)
}

// Create handles POST /v1/cases/{caseId}/estimates.
func (h *EstimateHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	var req createEstimateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.YourHourlyRate <= 0 {
		writeJSONError(w, "your_hourly_rate must be positive", http.StatusBadRequest)
		return
	}

	region := req.Region
	if region == "" {
		region = "japan"
	}

	includeMarket := true
	if req.IncludeMarketEvidence != nil {
		includeMarket = *req.IncludeMarketEvidence
	}

	estimate, err := h.svc.Create(r.Context(), service.CreateEstimateInput{
		TenantID:              tenantID,
		CaseID:                caseID,
		YourHourlyRate:        req.YourHourlyRate,
		Region:                region,
		IncludeMarketEvidence: includeMarket,
	})
	if err != nil {
		writeJSONError(w, "failed to create estimate", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"data": estimate})
}

// List handles GET /v1/cases/{caseId}/estimates.
func (h *EstimateHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	limit, offset := parsePagination(r)

	records, total, err := h.svc.ListByCaseID(r.Context(), tenantID, caseID, limit, offset)
	if err != nil {
		writeJSONError(w, "failed to list estimates", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"data":  records,
		"total": total,
	})
}

// GetByID handles GET /v1/cases/{caseId}/estimates/{estimateId}.
func (h *EstimateHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}
	estimateID, ok := parseEstimateUUID(w, r)
	if !ok {
		return
	}

	record, err := h.svc.GetByID(r.Context(), tenantID, caseID, estimateID)
	if err != nil {
		writeJSONError(w, "failed to get estimate", http.StatusInternalServerError)
		return
	}
	if record == nil {
		writeJSONError(w, "estimate not found", http.StatusNotFound)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": record})
}

// GetThreeWayProposal handles GET /v1/cases/{caseId}/estimates/{estimateId}/three-way-proposal.
func (h *EstimateHandler) GetThreeWayProposal(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}
	estimateID, ok := parseEstimateUUID(w, r)
	if !ok {
		return
	}

	proposal, err := h.svc.GetThreeWayProposal(r.Context(), tenantID, caseID, estimateID)
	if err != nil {
		writeJSONError(w, "failed to get three-way proposal", http.StatusInternalServerError)
		return
	}
	if proposal == nil {
		writeJSONError(w, "estimate not found", http.StatusNotFound)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": proposal})
}

// parseEstimateUUID extracts and validates the estimate UUID from the request path.
func parseEstimateUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	value, err := uuid.Parse(r.PathValue("estimateId"))
	if err != nil {
		writeJSONError(w, "invalid estimate ID", http.StatusBadRequest)
		return uuid.Nil, false
	}
	return value, true
}

type createEstimateRequest struct {
	YourHourlyRate        float64 `json:"your_hourly_rate"`
	Region                string  `json:"region"`
	IncludeMarketEvidence *bool   `json:"include_market_evidence"`
}
