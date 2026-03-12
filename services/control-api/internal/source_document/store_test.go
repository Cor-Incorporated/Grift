package sourcedocument

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestSQLStore_Create(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	caseID := uuid.New()

	t.Run("store not configured", func(t *testing.T) {
		err := (&SQLStore{}).Create(context.Background(), &domain.SourceDocument{})
		if err == nil {
			t.Fatal("Create() expected error")
		}
	})

	t.Run("happy path generates id", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New() error = %v", err)
		}
		defer db.Close()

		mock.ExpectQuery(`INSERT INTO source_documents`).
			WithArgs(sqlmock.AnyArg(), tenantID, caseID, "spec.pdf", "application/pdf", int64(42), domain.SourceKindFileUpload, nil, "bucket/path/spec.pdf", domain.SourceDocumentStatusPending).
			WillReturnRows(sqlmock.NewRows([]string{"created_at", "updated_at"}).AddRow(now, now))

		doc := &domain.SourceDocument{
			TenantID:   tenantID,
			CaseID:     caseID,
			FileName:   "spec.pdf",
			FileType:   ptr("application/pdf"),
			FileSize:   ptr[int64](42),
			SourceKind: domain.SourceKindFileUpload,
			GCSPath:    ptr("bucket/path/spec.pdf"),
			Status:     domain.SourceDocumentStatusPending,
		}
		store := &SQLStore{DB: db}

		err = store.Create(context.Background(), doc)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if doc.ID == uuid.Nil {
			t.Fatal("Create() did not assign ID")
		}
		if doc.CreatedAt != now || doc.UpdatedAt != now {
			t.Fatalf("Create() timestamps = %v/%v, want %v/%v", doc.CreatedAt, doc.UpdatedAt, now, now)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("ExpectationsWereMet() error = %v", err)
		}
	})

	t.Run("insert error", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New() error = %v", err)
		}
		defer db.Close()

		mock.ExpectQuery(`INSERT INTO source_documents`).
			WithArgs(sqlmock.AnyArg(), tenantID, caseID, "repo", nil, nil, domain.SourceKindRepositoryURL, "https://github.com/acme/repo", nil, domain.SourceDocumentStatusPending).
			WillReturnError(errors.New("insert failed"))

		doc := &domain.SourceDocument{
			TenantID:   tenantID,
			CaseID:     caseID,
			FileName:   "repo",
			SourceKind: domain.SourceKindRepositoryURL,
			SourceURL:  ptr("https://github.com/acme/repo"),
			Status:     domain.SourceDocumentStatusPending,
		}
		store := &SQLStore{DB: db}

		err = store.Create(context.Background(), doc)
		if err == nil {
			t.Fatal("Create() expected error")
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("ExpectationsWereMet() error = %v", err)
		}
	})
}

func TestSQLStore_ListByCase(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	analyzedAt := now.Add(5 * time.Minute)
	tenantID := uuid.New()
	caseID := uuid.New()
	docID := uuid.New()
	columns := []string{
		"id", "tenant_id", "case_id", "file_name", "file_type", "file_size",
		"source_kind", "source_url", "gcs_path", "status", "analysis_error",
		"analysis_result", "analyzed_at", "created_at", "updated_at",
	}

	tests := []struct {
		name      string
		mock      func(sqlmock.Sqlmock)
		limit     int
		offset    int
		wantCount int
		wantTotal int
		wantErr   bool
	}{
		{
			name:    "store not configured",
			wantErr: true,
		},
		{
			name:   "happy path normalizes pagination",
			limit:  -1,
			offset: -2,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\)`).
					WithArgs(tenantID, caseID).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				m.ExpectQuery(`SELECT id, tenant_id, case_id, file_name, file_type, file_size`).
					WithArgs(tenantID, caseID, 20, 0).
					WillReturnRows(sqlmock.NewRows(columns).AddRow(
						docID, tenantID, caseID, "spec.pdf", "application/pdf", int64(12),
						domain.SourceKindFileUpload, nil, "bucket/spec.pdf", domain.SourceDocumentStatusCompleted,
						"none", []byte(`{"summary":"ok"}`), analyzedAt, now, now,
					))
			},
			wantCount: 1,
			wantTotal: 1,
		},
		{
			name:  "count error",
			limit: 10,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\)`).
					WithArgs(tenantID, caseID).
					WillReturnError(errors.New("count failed"))
			},
			wantErr: true,
		},
		{
			name:  "query error",
			limit: 10,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\)`).
					WithArgs(tenantID, caseID).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				m.ExpectQuery(`SELECT id, tenant_id, case_id, file_name, file_type, file_size`).
					WithArgs(tenantID, caseID, 10, 0).
					WillReturnError(errors.New("query failed"))
			},
			wantErr: true,
		},
		{
			name:  "scan error",
			limit: 10,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\)`).
					WithArgs(tenantID, caseID).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				rows := sqlmock.NewRows(columns).
					AddRow("bad-id", tenantID, caseID, "spec.pdf", "application/pdf", int64(12),
						domain.SourceKindFileUpload, nil, nil, domain.SourceDocumentStatusPending, nil, nil, nil, now, now)
				m.ExpectQuery(`SELECT id, tenant_id, case_id, file_name, file_type, file_size`).
					WithArgs(tenantID, caseID, 10, 0).
					WillReturnRows(rows)
			},
			wantErr: true,
		},
		{
			name:  "row iteration error",
			limit: 10,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\)`).
					WithArgs(tenantID, caseID).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				rows := sqlmock.NewRows(columns).
					AddRow(docID, tenantID, caseID, "spec.pdf", nil, nil,
						domain.SourceKindWebsiteURL, "https://example.com/spec", nil, domain.SourceDocumentStatusPending, nil, nil, nil, now, now).
					RowError(0, errors.New("row error"))
				m.ExpectQuery(`SELECT id, tenant_id, case_id, file_name, file_type, file_size`).
					WithArgs(tenantID, caseID, 10, 0).
					WillReturnRows(rows)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.name == "store not configured" {
				_, _, err := (&SQLStore{}).ListByCase(context.Background(), tenantID, caseID, tt.limit, tt.offset)
				if (err != nil) != tt.wantErr {
					t.Fatalf("ListByCase() error = %v, wantErr %v", err, tt.wantErr)
				}
				return
			}

			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New() error = %v", err)
			}
			defer db.Close()

			tt.mock(mock)
			store := &SQLStore{DB: db}

			got, total, err := store.ListByCase(context.Background(), tenantID, caseID, tt.limit, tt.offset)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ListByCase() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				if len(got) != tt.wantCount {
					t.Fatalf("ListByCase() len = %d, want %d", len(got), tt.wantCount)
				}
				if total != tt.wantTotal {
					t.Fatalf("ListByCase() total = %d, want %d", total, tt.wantTotal)
				}
				if got[0].FileType == nil || *got[0].FileType != "application/pdf" {
					t.Fatalf("ListByCase() FileType = %v", got[0].FileType)
				}
				if got[0].GCSPath == nil || *got[0].GCSPath != "bucket/spec.pdf" {
					t.Fatalf("ListByCase() GCSPath = %v", got[0].GCSPath)
				}
				if got[0].AnalysisError == nil || *got[0].AnalysisError != "none" {
					t.Fatalf("ListByCase() AnalysisError = %v", got[0].AnalysisError)
				}
				if got[0].AnalyzedAt == nil || !got[0].AnalyzedAt.Equal(analyzedAt) {
					t.Fatalf("ListByCase() AnalyzedAt = %v, want %v", got[0].AnalyzedAt, analyzedAt)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func ptr[T any](v T) *T {
	return &v
}
