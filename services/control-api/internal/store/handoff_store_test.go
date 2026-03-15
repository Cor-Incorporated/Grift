package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestSQLHandoffStoreCreate(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	handoffID := uuid.New()
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()
	key := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`INSERT INTO handoff_packages`).
		WithArgs(handoffID, caseID, estimateID, nil, nil, nil, domain.HandoffStatusPending, nil, key).
		WillReturnRows(sqlmock.NewRows([]string{"tenant_id", "created_at", "updated_at"}).AddRow(tenantID, now, now))

	store := NewSQLHandoffStore(db)
	record := &domain.HandoffPackage{
		ID:             handoffID,
		CaseID:         caseID,
		EstimateID:     estimateID,
		Status:         domain.HandoffStatusPending,
		IdempotencyKey: key,
	}

	got, err := store.Create(context.Background(), record)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if got.TenantID != tenantID {
		t.Fatalf("Create() tenant_id = %v, want %v", got.TenantID, tenantID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}

func TestSQLHandoffStoreGetByCaseID(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	handoffID := uuid.New()
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()
	key := uuid.New()

	tests := []struct {
		name    string
		setup   func(sqlmock.Sqlmock)
		wantNil bool
		wantErr bool
	}{
		{
			name: "success",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT id, tenant_id, case_id, estimate_id, linear_project_id, linear_project_url,`).
					WithArgs(caseID).
					WillReturnRows(sqlmock.NewRows([]string{
						"id", "tenant_id", "case_id", "estimate_id", "linear_project_id", "linear_project_url",
						"github_project_url", "status", "error_message", "idempotency_key", "created_at", "updated_at",
					}).AddRow(handoffID, tenantID, caseID, estimateID, nil, nil, nil, domain.HandoffStatusPending, nil, key, now, now))
			},
		},
		{
			name: "not found",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT id, tenant_id, case_id, estimate_id, linear_project_id, linear_project_url,`).
					WithArgs(caseID).
					WillReturnError(sql.ErrNoRows)
			},
			wantNil: true,
		},
		{
			name: "wrapped no rows",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT id, tenant_id, case_id, estimate_id, linear_project_id, linear_project_url,`).
					WithArgs(caseID).
					WillReturnError(fmt.Errorf("query failed: %w", sql.ErrNoRows))
			},
			wantNil: true,
		},
		{
			name: "query error",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT id, tenant_id, case_id, estimate_id, linear_project_id, linear_project_url,`).
					WithArgs(caseID).
					WillReturnError(errors.New("db timeout"))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New() error = %v", err)
			}
			defer db.Close()

			tt.setup(mock)
			store := NewSQLHandoffStore(db)

			got, err := store.GetByCaseID(context.Background(), caseID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("GetByCaseID() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantNil && got != nil {
				t.Fatalf("GetByCaseID() = %+v, want nil", got)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLHandoffStoreUpdateStatus(t *testing.T) {
	handoffID := uuid.New()
	errMsg := "sync failed"

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectExec(`UPDATE handoff_packages`).
		WithArgs(domain.HandoffStatusError, &errMsg, handoffID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	store := NewSQLHandoffStore(db)
	if err := store.UpdateStatus(context.Background(), handoffID, domain.HandoffStatusError, &errMsg); err != nil {
		t.Fatalf("UpdateStatus() error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}

func TestSQLHandoffStoreIssueMappings(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	mappingID := uuid.New()
	tenantID := uuid.New()
	handoffID := uuid.New()
	moduleName := "billing"
	linearIssueID := "LIN-123"
	hours := 8.5

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`INSERT INTO handoff_issue_mappings`).
		WithArgs(mappingID, handoffID, moduleName, nil, &linearIssueID, nil, nil, nil, nil, &hours, nil).
		WillReturnRows(sqlmock.NewRows([]string{"tenant_id", "created_at", "updated_at"}).AddRow(tenantID, now, now))
	mock.ExpectQuery(`SELECT id, tenant_id, handoff_id, module_name, phase_name, linear_issue_id,`).
		WithArgs(handoffID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "handoff_id", "module_name", "phase_name", "linear_issue_id",
			"linear_issue_identifier", "linear_issue_url", "github_issue_number",
			"github_issue_url", "hours_estimate", "source_event_id", "created_at", "updated_at",
		}).AddRow(mappingID, tenantID, handoffID, moduleName, nil, linearIssueID, nil, nil, nil, nil, hours, nil, now, now))

	store := NewSQLHandoffStore(db)
	mapping := &domain.HandoffIssueMapping{
		ID:            mappingID,
		HandoffID:     handoffID,
		ModuleName:    moduleName,
		LinearIssueID: &linearIssueID,
		HoursEstimate: &hours,
	}

	created, err := store.CreateIssueMapping(context.Background(), mapping)
	if err != nil {
		t.Fatalf("CreateIssueMapping() error = %v", err)
	}
	if created.TenantID != tenantID {
		t.Fatalf("CreateIssueMapping() tenant_id = %v, want %v", created.TenantID, tenantID)
	}

	got, err := store.ListIssueMappings(context.Background(), handoffID)
	if err != nil {
		t.Fatalf("ListIssueMappings() error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("ListIssueMappings() len = %d, want 1", len(got))
	}
	if got[0].ModuleName != moduleName {
		t.Fatalf("ListIssueMappings() module_name = %q, want %q", got[0].ModuleName, moduleName)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}
