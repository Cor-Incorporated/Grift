package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

func TestSQLEstimateStoreCreate(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`INSERT INTO estimates`).
		WithArgs(
			estimateID, tenantID, caseID,
			domain.EstimateModeMarketComparison, domain.EstimateStatusDraft,
			float64(15000), float64(0), float64(0),
			nil, nil, nil, nil,
			nil,
			nil, nil, nil,
			float64(1.8), nil,
			json.RawMessage("{}"), pq.Array([]string{}), nil,
			json.RawMessage("{}"), json.RawMessage("{}"),
			json.RawMessage("{}"), json.RawMessage("{}"),
		).
		WillReturnRows(sqlmock.NewRows([]string{"created_at", "updated_at"}).
			AddRow(now, now))

	store := NewSQLEstimateStore(db)
	estimate := &domain.Estimate{
		ID:                  estimateID,
		TenantID:            tenantID,
		CaseID:              caseID,
		EstimateMode:        domain.EstimateModeMarketComparison,
		Status:              domain.EstimateStatusDraft,
		YourHourlyRate:      15000,
		YourEstimatedHours:  0,
		TotalYourCost:       0,
		Multiplier:          1.8,
		RiskFlags:           []string{},
		PricingSnapshot:     json.RawMessage("{}"),
		HistoricalCitations: json.RawMessage("{}"),
		ThreeWayProposal:    json.RawMessage("{}"),
		GoNoGoResult:        json.RawMessage("{}"),
		ValueProposition:    json.RawMessage("{}"),
	}

	result, err := store.Create(context.Background(), estimate)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if result.ID != estimateID {
		t.Fatalf("result.ID = %s, want %s", result.ID, estimateID)
	}
	if result.CreatedAt != now {
		t.Fatalf("result.CreatedAt = %v, want %v", result.CreatedAt, now)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}

func TestSQLEstimateStoreGetByID(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT id, tenant_id, case_id`).
		WithArgs(tenantID, caseID, estimateID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "case_id", "estimate_mode", "status",
			"your_hourly_rate", "your_estimated_hours", "total_your_cost",
			"hours_investigation", "hours_implementation", "hours_testing", "hours_buffer",
			"hours_breakdown_report",
			"market_hourly_rate", "market_estimated_hours", "total_market_cost",
			"multiplier", "aggregated_evidence_id",
			"pricing_snapshot", "risk_flags", "calibration_ratio",
			"historical_citations", "three_way_proposal",
			"go_no_go_result", "value_proposition",
			"created_at", "updated_at",
		}).AddRow(
			estimateID, tenantID, caseID,
			"market_comparison", "draft",
			15000.0, 40.0, 600000.0,
			10.0, 20.0, 8.0, 2.0,
			"breakdown report",
			12000.0, 50.0, 600000.0,
			1.8, nil,
			[]byte(`{"key":"value"}`), pq.Array([]string{"scope_creep"}), 0.85,
			[]byte(`{}`), []byte(`{"proposal":"data"}`),
			[]byte(`{}`), []byte(`{}`),
			now, now,
		))

	store := NewSQLEstimateStore(db)
	record, err := store.GetByID(context.Background(), tenantID, caseID, estimateID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if record == nil {
		t.Fatal("GetByID() returned nil record")
	}
	if record.ID != estimateID {
		t.Fatalf("record.ID = %s, want %s", record.ID, estimateID)
	}
	if record.YourHourlyRate != 15000.0 {
		t.Fatalf("record.YourHourlyRate = %f, want 15000", record.YourHourlyRate)
	}
	if len(record.RiskFlags) != 1 || record.RiskFlags[0] != "scope_creep" {
		t.Fatalf("record.RiskFlags = %v, want [scope_creep]", record.RiskFlags)
	}
	if record.HoursInvestigation == nil || *record.HoursInvestigation != 10.0 {
		t.Fatalf("record.HoursInvestigation = %v, want 10.0", record.HoursInvestigation)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}

func TestSQLEstimateStoreGetByIDNotFound(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT id, tenant_id, case_id`).
		WithArgs(tenantID, caseID, estimateID).
		WillReturnError(sql.ErrNoRows)

	store := NewSQLEstimateStore(db)
	record, err := store.GetByID(context.Background(), tenantID, caseID, estimateID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if record != nil {
		t.Fatalf("GetByID() = %+v, want nil", record)
	}
}

func TestSQLEstimateStoreGetByIDQueryError(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT id, tenant_id, case_id`).
		WithArgs(tenantID, caseID, estimateID).
		WillReturnError(errors.New("db timeout"))

	store := NewSQLEstimateStore(db)
	record, err := store.GetByID(context.Background(), tenantID, caseID, estimateID)
	if err == nil {
		t.Fatal("expected error")
	}
	if record != nil {
		t.Fatalf("GetByID() = %+v, want nil", record)
	}
}

func TestSQLEstimateStoreListByCaseID(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT COUNT`).
		WithArgs(tenantID, caseID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(`SELECT id, tenant_id, case_id`).
		WithArgs(tenantID, caseID, 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "case_id", "estimate_mode", "status",
			"your_hourly_rate", "your_estimated_hours", "total_your_cost",
			"hours_investigation", "hours_implementation", "hours_testing", "hours_buffer",
			"hours_breakdown_report",
			"market_hourly_rate", "market_estimated_hours", "total_market_cost",
			"multiplier", "aggregated_evidence_id",
			"pricing_snapshot", "risk_flags", "calibration_ratio",
			"historical_citations", "three_way_proposal",
			"go_no_go_result", "value_proposition",
			"created_at", "updated_at",
		}).AddRow(
			estimateID, tenantID, caseID,
			"market_comparison", "draft",
			15000.0, 0.0, 0.0,
			nil, nil, nil, nil,
			nil,
			nil, nil, nil,
			1.8, nil,
			[]byte(`{}`), pq.Array([]string{}), nil,
			[]byte(`{}`), []byte(`{}`),
			[]byte(`{}`), []byte(`{}`),
			now, now,
		))

	store := NewSQLEstimateStore(db)
	records, total, err := store.ListByCaseID(context.Background(), tenantID, caseID, 20, 0)
	if err != nil {
		t.Fatalf("ListByCaseID() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(records) != 1 {
		t.Fatalf("len(records) = %d, want 1", len(records))
	}
	if records[0].ID != estimateID {
		t.Fatalf("records[0].ID = %s, want %s", records[0].ID, estimateID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}

func TestSQLEstimateStoreUpdateThreeWayProposal(t *testing.T) {
	tenantID := uuid.New()
	estimateID := uuid.New()
	proposal := json.RawMessage(`{"option_a":{"label":"Budget"}}`)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectExec(`UPDATE estimates SET three_way_proposal`).
		WithArgs(tenantID, estimateID, proposal).
		WillReturnResult(sqlmock.NewResult(0, 1))

	store := NewSQLEstimateStore(db)
	err = store.UpdateThreeWayProposal(context.Background(), tenantID, estimateID, proposal)
	if err != nil {
		t.Fatalf("UpdateThreeWayProposal() error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}

func TestSQLEstimateStoreUpdateThreeWayProposalNotFound(t *testing.T) {
	tenantID := uuid.New()
	estimateID := uuid.New()
	proposal := json.RawMessage(`{}`)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectExec(`UPDATE estimates SET three_way_proposal`).
		WithArgs(tenantID, estimateID, proposal).
		WillReturnResult(sqlmock.NewResult(0, 0))

	store := NewSQLEstimateStore(db)
	err = store.UpdateThreeWayProposal(context.Background(), tenantID, estimateID, proposal)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("err = %v, want sql.ErrNoRows", err)
	}
}
