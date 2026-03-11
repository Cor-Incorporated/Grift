package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestCaseHandlerCreateCase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	now := time.Now()
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	mock.ExpectQuery("INSERT INTO cases").
		WithArgs(
			sqlmock.AnyArg(),
			uuid.MustParse(tenantID),
			"New intake",
			"new_project",
			"draft",
			nil,
			nil,
			nil,
			nil,
			nil,
		).
		WillReturnRows(sqlmock.NewRows([]string{"created_at", "updated_at"}).AddRow(now, now))

	h := NewCaseHandler(db)
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases", bytes.NewBufferString(`{"title":"New intake","type":"new_project"}`))
	req.Header.Set("X-Tenant-ID", tenantID)
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var body map[string]map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if body["data"]["title"] != "New intake" {
		t.Fatalf("title = %v, want %q", body["data"]["title"], "New intake")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}

func TestCaseHandlerListCases(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	now := time.Now()

	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM cases WHERE tenant_id = \\$1").
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery("SELECT id, tenant_id, title, type, status, priority, business_line, existing_system_url, spec_markdown, contact_name, contact_email, company_name, created_by_uid, created_at, updated_at FROM cases WHERE tenant_id = \\$1 ORDER BY created_at DESC LIMIT \\$2 OFFSET \\$3").
		WithArgs(tenantID, 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "title", "type", "status", "priority", "business_line",
			"existing_system_url", "spec_markdown", "contact_name", "contact_email",
			"company_name", "created_by_uid", "created_at", "updated_at",
		}).AddRow(uuid.New(), tenantID, "List item", "new_project", "draft", nil, nil, nil, nil, nil, nil, nil, nil, now, now))

	h := NewCaseHandler(db)
	mux := http.NewServeMux()
	RegisterCaseRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body struct {
		Data  []map[string]any `json:"data"`
		Total float64          `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if len(body.Data) != 1 {
		t.Fatalf("len(data) = %d, want 1", len(body.Data))
	}
	if body.Total != 1 {
		t.Fatalf("total = %v, want 1", body.Total)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}
