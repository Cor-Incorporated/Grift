package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

func TestSQLMarketEvidenceStoreGetByID(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	evidenceID := uuid.New()
	caseID := uuid.New()
	fragmentID := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	contradictions, _ := json.Marshal([]map[string]string{
		{
			"provider_a":  "grok",
			"provider_b":  "brave",
			"field":       "total_hours_range",
			"description": "grok and brave disagree",
		},
	})
	citations, _ := json.Marshal([]map[string]string{
		{
			"url":              "https://example.com/report",
			"title":            "Report",
			"source_authority": "industry",
			"snippet":          "Benchmark",
		},
	})

	mock.ExpectQuery(`SELECT id, case_id, fragment_ids`).
		WithArgs(tenantID, evidenceID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "case_id", "fragment_ids",
			"consensus_hours_min", "consensus_hours_max",
			"consensus_rate_min", "consensus_rate_max",
			"overall_confidence", "contradictions",
			"requires_human_review", "aggregated_at",
		}).AddRow(
			evidenceID,
			caseID,
			pq.Array([]string{fragmentID.String()}),
			200.0,
			320.0,
			100.0,
			160.0,
			"medium",
			contradictions,
			true,
			now,
		))
	mock.ExpectQuery(`SELECT id, provider`).
		WithArgs(tenantID, pq.Array([]string{fragmentID.String()})).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "provider",
			"hourly_rate_min", "hourly_rate_max",
			"total_hours_min", "total_hours_max",
			"team_size_min", "team_size_max",
			"duration_weeks_min", "duration_weeks_max",
			"citations", "provider_confidence", "retrieved_at",
		}).AddRow(
			fragmentID,
			"grok",
			100.0,
			160.0,
			200.0,
			320.0,
			2,
			4,
			6,
			10,
			citations,
			0.8,
			now,
		))

	store := NewSQLMarketEvidenceStore(db)
	record, err := store.GetByID(context.Background(), tenantID, evidenceID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if record == nil {
		t.Fatal("GetByID() returned nil record")
	}
	if record.ID != evidenceID {
		t.Fatalf("record.ID = %s, want %s", record.ID, evidenceID)
	}
	if len(record.Fragments) != 1 {
		t.Fatalf("len(record.Fragments) = %d, want 1", len(record.Fragments))
	}
	if record.Fragments[0].Provider != "grok" {
		t.Fatalf("fragment provider = %q, want grok", record.Fragments[0].Provider)
	}
	if len(record.Contradictions) != 1 {
		t.Fatalf("len(record.Contradictions) = %d, want 1", len(record.Contradictions))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}

func TestSQLMarketEvidenceStoreGetByIDNotFound(t *testing.T) {
	tenantID := uuid.New()
	evidenceID := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT id, case_id, fragment_ids`).
		WithArgs(tenantID, evidenceID).
		WillReturnError(sql.ErrNoRows)

	store := NewSQLMarketEvidenceStore(db)
	record, err := store.GetByID(context.Background(), tenantID, evidenceID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if record != nil {
		t.Fatalf("GetByID() = %+v, want nil", record)
	}
}

func TestSQLMarketEvidenceStoreGetByIDQueryError(t *testing.T) {
	tenantID := uuid.New()
	evidenceID := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT id, case_id, fragment_ids`).
		WithArgs(tenantID, evidenceID).
		WillReturnError(errors.New("db timeout"))

	store := NewSQLMarketEvidenceStore(db)
	record, err := store.GetByID(context.Background(), tenantID, evidenceID)
	if err == nil {
		t.Fatal("expected error")
	}
	if record != nil {
		t.Fatalf("GetByID() = %+v, want nil", record)
	}
}
