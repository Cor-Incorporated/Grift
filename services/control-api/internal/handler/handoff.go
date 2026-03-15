package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

// HandoffHandler serves handoff endpoints.
type HandoffHandler struct {
	svc *service.HandoffService
}

// NewHandoffHandler creates a HandoffHandler.
func NewHandoffHandler(svc *service.HandoffService) *HandoffHandler {
	if svc == nil {
		panic("handoff service must not be nil")
	}
	return &HandoffHandler{svc: svc}
}

// RegisterHandoffRoutes registers handoff routes on the given mux.
func RegisterHandoffRoutes(mux *http.ServeMux, h *HandoffHandler) {
	mux.HandleFunc("POST /v1/cases/{caseId}/handoffs", h.CreateHandoff)
	mux.HandleFunc("GET /v1/cases/{caseId}/handoffs", h.GetHandoffStatus)
}

// CreateHandoff handles POST /v1/cases/{caseId}/handoffs.
func (h *HandoffHandler) CreateHandoff(w http.ResponseWriter, r *http.Request) {
	if _, ok := parseTenantUUID(w, r); !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	var req createHandoffRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	estimateID, err := uuid.Parse(req.EstimateID)
	if err != nil {
		writeJSONError(w, "invalid estimate ID", http.StatusBadRequest)
		return
	}
	idempotencyKey, err := uuid.Parse(req.IdempotencyKey)
	if err != nil {
		writeJSONError(w, "invalid idempotency key", http.StatusBadRequest)
		return
	}

	handoff, err := h.svc.Create(r.Context(), caseID, estimateID, idempotencyKey)
	if err != nil {
		writeHandoffCreateError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"data": newHandoffResponse(handoff, nil)})
}

// GetHandoffStatus handles GET /v1/cases/{caseId}/handoffs.
func (h *HandoffHandler) GetHandoffStatus(w http.ResponseWriter, r *http.Request) {
	if _, ok := parseTenantUUID(w, r); !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	handoff, mappings, err := h.svc.GetByCaseID(r.Context(), caseID)
	if err != nil {
		writeHandoffGetError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": newHandoffResponse(handoff, mappings)})
}

func writeHandoffCreateError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		writeJSONError(w, "estimate not found", http.StatusNotFound)
	case errors.Is(err, service.ErrIdempotencyConflict):
		writeJSONError(w, err.Error(), http.StatusConflict)
	default:
		writeJSONError(w, "failed to create handoff", http.StatusInternalServerError)
	}
}

func writeHandoffGetError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		writeJSONError(w, "handoff not found", http.StatusNotFound)
	default:
		writeJSONError(w, "failed to get handoff", http.StatusInternalServerError)
	}
}

func newHandoffResponse(handoff *domain.HandoffPackage, mappings []domain.HandoffIssueMapping) handoffResponse {
	response := handoffResponse{
		ID:               handoff.ID,
		CaseID:           handoff.CaseID,
		EstimateID:       handoff.EstimateID,
		LinearProjectID:  handoff.LinearProjectID,
		LinearProjectURL: handoff.LinearProjectURL,
		GithubProjectURL: handoff.GithubProjectURL,
		Status:           handoff.Status,
		CreatedAt:        handoff.CreatedAt,
	}
	if len(mappings) == 0 {
		return response
	}
	response.LinearIssues = make([]handoffIssueResponse, 0, len(mappings))
	for _, mapping := range mappings {
		response.LinearIssues = append(response.LinearIssues, handoffIssueResponse{
			ModuleName:     mapping.ModuleName,
			LinearIssueID:  mapping.LinearIssueID,
			LinearIssueURL: mapping.LinearIssueURL,
			GithubIssueURL: mapping.GithubIssueURL,
		})
	}
	return response
}

type createHandoffRequest struct {
	EstimateID     string `json:"estimate_id"`
	IdempotencyKey string `json:"idempotency_key"`
}

type handoffResponse struct {
	ID               uuid.UUID              `json:"id"`
	CaseID           uuid.UUID              `json:"case_id"`
	EstimateID       uuid.UUID              `json:"estimate_id"`
	LinearProjectID  *string                `json:"linear_project_id,omitempty"`
	LinearProjectURL *string                `json:"linear_project_url,omitempty"`
	GithubProjectURL *string                `json:"github_project_url,omitempty"`
	LinearIssues     []handoffIssueResponse `json:"linear_issues,omitempty"`
	Status           domain.HandoffStatus   `json:"status"`
	CreatedAt        time.Time              `json:"created_at"`
}

type handoffIssueResponse struct {
	ModuleName     string  `json:"module_name"`
	LinearIssueID  *string `json:"linear_issue_id,omitempty"`
	LinearIssueURL *string `json:"linear_issue_url,omitempty"`
	GithubIssueURL *string `json:"github_issue_url,omitempty"`
}
