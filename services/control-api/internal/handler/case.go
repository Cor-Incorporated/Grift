package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/google/uuid"
)

// CaseHandler handles case CRUD operations.
type CaseHandler struct {
	db *sql.DB
}

// NewCaseHandler constructs a CaseHandler.
func NewCaseHandler(db *sql.DB) *CaseHandler {
	return &CaseHandler{db: db}
}

// RegisterCaseRoutes registers case routes.
func RegisterCaseRoutes(mux *http.ServeMux, h *CaseHandler) {
	mux.HandleFunc("GET /v1/cases", h.ListCases)
	mux.HandleFunc("POST /v1/cases", h.CreateCase)
	mux.HandleFunc("GET /v1/cases/{caseId}", h.GetCase)
}

// CreateCase handles POST /v1/cases.
func (h *CaseHandler) CreateCase(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSONError(w, "database not configured", http.StatusServiceUnavailable)
		return
	}

	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}

	var req createCaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeJSONError(w, "title is required", http.StatusBadRequest)
		return
	}
	if !domain.CaseType(req.Type).IsValid() {
		writeJSONError(w, "invalid case type", http.StatusBadRequest)
		return
	}

	record, err := h.insertCase(r.Context(), tenantID, req)
	if err != nil {
		writeJSONError(w, "failed to create case", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": record})
}

// ListCases handles GET /v1/cases.
func (h *CaseHandler) ListCases(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSONError(w, "database not configured", http.StatusServiceUnavailable)
		return
	}

	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}

	limit, offset := parsePagination(r)
	records, total, err := h.listCases(r.Context(), tenantID, r.URL.Query().Get("status"), r.URL.Query().Get("type"), limit, offset)
	if err != nil {
		writeJSONError(w, "failed to list cases", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data":  records,
		"total": total,
	})
}

// GetCase handles GET /v1/cases/{caseId}.
func (h *CaseHandler) GetCase(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSONError(w, "database not configured", http.StatusServiceUnavailable)
		return
	}

	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	record, err := h.getCase(r.Context(), tenantID, caseID)
	if err == sql.ErrNoRows {
		writeJSONError(w, "case not found", http.StatusNotFound)
		return
	}
	if err != nil {
		writeJSONError(w, "failed to get case", http.StatusInternalServerError)
		return
	}

	turns, _, err := listConversationTurns(r.Context(), h.db, tenantID, caseID, maxLimit, 0)
	if err != nil {
		writeJSONError(w, "failed to get case conversations", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"data": caseWithDetails{
			Case:          *record,
			Conversations: turns,
			SourceDocs:    []any{},
			Estimates:     []any{},
		},
	})
}

func (h *CaseHandler) insertCase(ctx context.Context, tenantID uuid.UUID, req createCaseRequest) (*domain.Case, error) {
	record := &domain.Case{
		ID:                uuid.New(),
		TenantID:          tenantID,
		Title:             strings.TrimSpace(req.Title),
		Type:              domain.CaseType(req.Type),
		Status:            domain.CaseStatusDraft,
		ExistingSystemURL: nilIfBlank(req.ExistingSystemURL),
		CompanyName:       nilIfBlank(req.CompanyName),
		ContactName:       nilIfBlank(req.ContactName),
		ContactEmail:      nilIfBlank(req.ContactEmail),
		CreatedByUID:      nilIfBlank(middleware.UserIDFromContext(ctx)),
	}

	row := dbExecutorFromContext(ctx, h.db).QueryRowContext(
		ctx,
		`INSERT INTO cases (
			id, tenant_id, title, type, status,
			existing_system_url, company_name, contact_name, contact_email, created_by_uid
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING created_at, updated_at`,
		record.ID,
		record.TenantID,
		record.Title,
		record.Type,
		record.Status,
		record.ExistingSystemURL,
		record.CompanyName,
		record.ContactName,
		record.ContactEmail,
		record.CreatedByUID,
	)
	if err := row.Scan(&record.CreatedAt, &record.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert case: %w", err)
	}
	return record, nil
}

func (h *CaseHandler) listCases(ctx context.Context, tenantID uuid.UUID, statusFilter string, typeFilter string, limit int, offset int) ([]domain.Case, int, error) {
	query := `SELECT id, tenant_id, title, type, status, priority, business_line, existing_system_url, spec_markdown, contact_name, contact_email, company_name, created_by_uid, created_at, updated_at FROM cases WHERE tenant_id = $1`
	countQuery := `SELECT COUNT(*) FROM cases WHERE tenant_id = $1`
	args := []any{tenantID}

	if statusFilter != "" && domain.CaseStatus(statusFilter).IsValid() {
		query += fmt.Sprintf(" AND status = $%d", len(args)+1)
		countQuery += fmt.Sprintf(" AND status = $%d", len(args)+1)
		args = append(args, statusFilter)
	}
	if typeFilter != "" && domain.CaseType(typeFilter).IsValid() {
		query += fmt.Sprintf(" AND type = $%d", len(args)+1)
		countQuery += fmt.Sprintf(" AND type = $%d", len(args)+1)
		args = append(args, typeFilter)
	}

	var total int
	if err := dbExecutorFromContext(ctx, h.db).QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count cases: %w", err)
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, limit, offset)

	rows, err := dbExecutorFromContext(ctx, h.db).QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list cases: %w", err)
	}
	defer rows.Close()

	var records []domain.Case
	for rows.Next() {
		record, err := scanCase(rows)
		if err != nil {
			return nil, 0, err
		}
		records = append(records, *record)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate cases: %w", err)
	}
	return records, total, nil
}

func (h *CaseHandler) getCase(ctx context.Context, tenantID uuid.UUID, caseID uuid.UUID) (*domain.Case, error) {
	row := dbExecutorFromContext(ctx, h.db).QueryRowContext(
		ctx,
		`SELECT id, tenant_id, title, type, status, priority, business_line, existing_system_url, spec_markdown, contact_name, contact_email, company_name, created_by_uid, created_at, updated_at
		FROM cases
		WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		caseID,
	)
	return scanCase(row)
}

type createCaseRequest struct {
	Title             string `json:"title"`
	Type              string `json:"type"`
	ExistingSystemURL string `json:"existing_system_url"`
	CompanyName       string `json:"company_name"`
	ContactName       string `json:"contact_name"`
	ContactEmail      string `json:"contact_email"`
}

type caseWithDetails struct {
	domain.Case
	Conversations []conversationTurnResponse `json:"conversations"`
	SourceDocs    []any                      `json:"source_documents"`
	Estimates     []any                      `json:"estimates"`
}

type rowScanner interface {
	Scan(dest ...any) error
}

type dbExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func dbExecutorFromContext(ctx context.Context, db *sql.DB) dbExecutor {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return db
}

func scanCase(scanner rowScanner) (*domain.Case, error) {
	var record domain.Case
	var priority sql.NullString
	if err := scanner.Scan(
		&record.ID,
		&record.TenantID,
		&record.Title,
		&record.Type,
		&record.Status,
		&priority,
		&record.BusinessLine,
		&record.ExistingSystemURL,
		&record.SpecMarkdown,
		&record.ContactName,
		&record.ContactEmail,
		&record.CompanyName,
		&record.CreatedByUID,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if priority.Valid {
		value := domain.CasePriority(priority.String)
		record.Priority = &value
	}
	return &record, nil
}

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

func parseCaseUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	value, err := uuid.Parse(r.PathValue("caseId"))
	if err != nil {
		writeJSONError(w, "invalid case ID", http.StatusBadRequest)
		return uuid.Nil, false
	}
	return value, true
}

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

func nilIfBlank(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
