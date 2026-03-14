package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

// ProposalHandler serves proposal and go/no-go endpoints.
type ProposalHandler struct {
	svc *service.ProposalService
}

// NewProposalHandler creates a ProposalHandler.
func NewProposalHandler(svc *service.ProposalService) *ProposalHandler {
	if svc == nil {
		panic("proposal service must not be nil")
	}
	return &ProposalHandler{svc: svc}
}

// RegisterProposalRoutes registers proposal and go/no-go routes on the given mux.
func RegisterProposalRoutes(mux *http.ServeMux, h *ProposalHandler) {
	mux.HandleFunc("POST /v1/cases/{caseId}/proposals", h.Create)
	mux.HandleFunc("GET /v1/cases/{caseId}/proposals", h.List)
	mux.HandleFunc("POST /v1/cases/{caseId}/proposals/{proposalId}/approve", h.Approve)
	mux.HandleFunc("POST /v1/cases/{caseId}/proposals/{proposalId}/reject", h.Reject)
	mux.HandleFunc("GET /v1/cases/{caseId}/go-no-go", h.EvaluateGoNoGo)
}

// Create handles POST /v1/cases/{caseId}/proposals.
func (h *ProposalHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	var req createProposalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	estimateID, err := uuid.Parse(req.EstimateID)
	if err != nil {
		writeJSONError(w, "invalid estimate ID", http.StatusBadRequest)
		return
	}

	proposal, err := h.svc.CreateProposal(r.Context(), tenantID, caseID, estimateID)
	if err != nil {
		writeProposalError(w, err, "estimate not found")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"data": proposal})
}

// List handles GET /v1/cases/{caseId}/proposals.
func (h *ProposalHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	limit, offset := parsePagination(r)
	records, total, err := h.svc.ListProposals(r.Context(), tenantID, caseID, limit, offset)
	if err != nil {
		writeJSONError(w, "failed to list proposals", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"data":  records,
		"total": total,
	})
}

// Approve handles POST /v1/cases/{caseId}/proposals/{proposalId}/approve.
func (h *ProposalHandler) Approve(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}
	proposalID, ok := parseProposalUUID(w, r)
	if !ok {
		return
	}

	var req decisionCommentRequest
	if err := decodeOptionalJSONBody(r, &req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	decision, err := h.svc.ApproveProposal(
		r.Context(),
		tenantID,
		caseID,
		proposalID,
		middleware.UserIDFromContext(r.Context()),
		"",
		req.Comment,
	)
	if err != nil {
		writeProposalError(w, err, "proposal not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": decision})
}

// Reject handles POST /v1/cases/{caseId}/proposals/{proposalId}/reject.
func (h *ProposalHandler) Reject(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}
	proposalID, ok := parseProposalUUID(w, r)
	if !ok {
		return
	}

	var req rejectProposalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	decision, err := h.svc.RejectProposal(
		r.Context(),
		tenantID,
		caseID,
		proposalID,
		middleware.UserIDFromContext(r.Context()),
		"",
		req.Reason,
	)
	if err != nil {
		writeProposalError(w, err, "proposal not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": decision})
}

// EvaluateGoNoGo handles GET /v1/cases/{caseId}/go-no-go.
func (h *ProposalHandler) EvaluateGoNoGo(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	result, err := h.svc.EvaluateGoNoGo(r.Context(), tenantID, caseID)
	if err != nil {
		writeProposalError(w, err, "go/no-go inputs not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

func decodeOptionalJSONBody(r *http.Request, v any) error {
	if r.Body == nil {
		return nil
	}
	err := json.NewDecoder(r.Body).Decode(v)
	if errors.Is(err, io.EOF) {
		return nil
	}
	return err
}

func writeProposalError(w http.ResponseWriter, err error, notFoundMessage string) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		writeJSONError(w, notFoundMessage, http.StatusNotFound)
	case isProposalBadRequest(err):
		writeJSONError(w, err.Error(), http.StatusBadRequest)
	default:
		writeJSONError(w, "failed to process proposal request", http.StatusInternalServerError)
	}
}

func isProposalBadRequest(err error) bool {
	return errors.Is(err, service.ErrAlreadyDecided) || errors.Is(err, service.ErrReasonRequired)
}

type createProposalRequest struct {
	EstimateID string `json:"estimate_id"`
}

type decisionCommentRequest struct {
	Comment string `json:"comment"`
}

type rejectProposalRequest struct {
	Reason string `json:"reason"`
}
