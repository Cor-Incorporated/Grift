package handler

import (
	"encoding/json"
	"net/http"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/google/uuid"
)

// TenantHandler handles tenant CRUD operations via the service layer.
type TenantHandler struct {
	svc *service.TenantService
}

// NewTenantHandler constructs a TenantHandler backed by the given service.
func NewTenantHandler(svc *service.TenantService) *TenantHandler {
	return &TenantHandler{svc: svc}
}

// RegisterTenantRoutes registers tenant routes on the provided mux.
func RegisterTenantRoutes(mux *http.ServeMux, h *TenantHandler) {
	mux.HandleFunc("POST /v1/tenants", h.CreateTenant)
	mux.HandleFunc("GET /v1/tenants", h.ListTenants)
	mux.HandleFunc("PATCH /v1/tenants/{tenantId}/settings", h.UpdateTenantSettings)
	mux.HandleFunc("POST /v1/tenants/{tenantId}/members", h.AddTenantMember)
	mux.HandleFunc("GET /v1/tenants/{tenantId}/members", h.ListTenantMembers)
}

// CreateTenant handles POST /v1/tenants.
func (h *TenantHandler) CreateTenant(w http.ResponseWriter, r *http.Request) {
	var req createTenantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	result, err := h.svc.Create(r.Context(), service.CreateTenantInput{
		Name: req.Name,
		Slug: req.Slug,
	})
	if err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}

// ListTenants handles GET /v1/tenants.
// Requires system_admin role (x-required-roles per OpenAPI spec).
func (h *TenantHandler) ListTenants(w http.ResponseWriter, r *http.Request) {
	if role := extractUserRole(r); role != "system_admin" {
		writeJSONError(w, "forbidden: system_admin role required", http.StatusForbidden)
		return
	}

	limit, offset := parsePagination(r)

	records, total, err := h.svc.List(r.Context(), limit, offset)
	if err != nil {
		writeJSONError(w, "failed to list tenants", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": records, "total": total})
}

// UpdateTenantSettings handles PATCH /v1/tenants/{tenantId}/settings.
// Requires tenant_admin role (x-required-roles per OpenAPI spec).
func (h *TenantHandler) UpdateTenantSettings(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantPathUUID(w, r)
	if !ok {
		return
	}

	userID := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		writeJSONError(w, "unauthorized: missing user identity", http.StatusUnauthorized)
		return
	}
	isAdmin, err := h.svc.IsTenantAdmin(r.Context(), tenantID, userID)
	if err != nil {
		writeJSONError(w, "failed to verify permissions", http.StatusInternalServerError)
		return
	}
	if !isAdmin {
		writeJSONError(w, "forbidden: tenant_admin role required", http.StatusForbidden)
		return
	}

	var req updateTenantSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	result, err := h.svc.UpdateSettings(r.Context(), tenantID, service.UpdateSettingsInput{
		AnalyticsOptIn: req.AnalyticsOptIn,
		TrainingOptIn:  req.TrainingOptIn,
		Settings:       req.Settings,
	})
	if err != nil {
		if err.Error() == "tenant not found" {
			writeJSONError(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

// AddTenantMember handles POST /v1/tenants/{tenantId}/members.
func (h *TenantHandler) AddTenantMember(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantPathUUID(w, r)
	if !ok {
		return
	}

	var req addTenantMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	result, err := h.svc.AddMember(r.Context(), tenantID, service.AddMemberInput{
		FirebaseUID: req.FirebaseUID,
		Email:       nilIfBlank(req.Email),
		DisplayName: nilIfBlank(req.DisplayName),
		Role:        domain.MemberRole(req.Role),
	})
	if err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}

// ListTenantMembers handles GET /v1/tenants/{tenantId}/members.
func (h *TenantHandler) ListTenantMembers(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := parseTenantPathUUID(w, r)
	if !ok {
		return
	}

	limit, offset := parsePagination(r)

	records, total, err := h.svc.ListMembers(r.Context(), tenantID, limit, offset)
	if err != nil {
		writeJSONError(w, "failed to list tenant members", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": records, "total": total})
}

// parseTenantPathUUID extracts and validates the tenant UUID from the URL path parameter.
func parseTenantPathUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	value, err := uuid.Parse(r.PathValue("tenantId"))
	if err != nil {
		writeJSONError(w, "invalid tenant ID", http.StatusBadRequest)
		return uuid.Nil, false
	}
	return value, true
}

// createTenantRequest is the JSON body for POST /v1/tenants.
type createTenantRequest struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// updateTenantSettingsRequest is the JSON body for PATCH /v1/tenants/{tenantId}/settings.
type updateTenantSettingsRequest struct {
	AnalyticsOptIn *bool           `json:"analytics_opt_in,omitempty"`
	TrainingOptIn  *bool           `json:"training_opt_in,omitempty"`
	Settings       json.RawMessage `json:"settings,omitempty"`
}

// addTenantMemberRequest is the JSON body for POST /v1/tenants/{tenantId}/members.
type addTenantMemberRequest struct {
	FirebaseUID string `json:"firebase_uid"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}
