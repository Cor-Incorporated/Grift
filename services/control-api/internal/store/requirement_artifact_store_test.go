package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func artifactColumns() []string {
	return []string{
		"id", "tenant_id", "case_id", "version", "markdown",
		"source_chunks", "status", "created_by_uid",
		"created_at", "updated_at",
	}
}

func TestSQLRequirementArtifactStore_GetLatestByCaseID(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	tenantID := uuid.New()
	caseID := uuid.New()
	artifactID := uuid.New()
	chunk1 := uuid.New()
	chunk2 := uuid.New()
	uid := "user-123"

	tests := []struct {
		name       string
		mock       func(sqlmock.Sqlmock)
		wantNil    bool
		wantErr    bool
		wantVer    int
		wantStatus domain.ArtifactStatus
	}{
		{
			name: "happy path with artifact found",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT .+ FROM requirement_artifacts`).
					WithArgs(tenantID, caseID).
					WillReturnRows(
						sqlmock.NewRows(artifactColumns()).
							AddRow(artifactID, tenantID, caseID, 3, "# Requirements\n",
								"{"+chunk1.String()+","+chunk2.String()+"}", "draft", &uid,
								now, now),
					)
			},
			wantNil:    false,
			wantErr:    false,
			wantVer:    3,
			wantStatus: domain.ArtifactStatusDraft,
		},
		{
			name: "no artifact found returns nil nil",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT .+ FROM requirement_artifacts`).
					WithArgs(tenantID, caseID).
					WillReturnRows(sqlmock.NewRows(artifactColumns()))
			},
			wantNil: true,
			wantErr: false,
		},
		{
			name: "database error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT .+ FROM requirement_artifacts`).
					WithArgs(tenantID, caseID).
					WillReturnError(errors.New("connection refused"))
			},
			wantNil: false,
			wantErr: true,
		},
		{
			name: "empty source chunks array",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT .+ FROM requirement_artifacts`).
					WithArgs(tenantID, caseID).
					WillReturnRows(
						sqlmock.NewRows(artifactColumns()).
							AddRow(artifactID, tenantID, caseID, 1, "# Spec",
								"{}", "finalized", nil,
								now, now),
					)
			},
			wantNil:    false,
			wantErr:    false,
			wantVer:    1,
			wantStatus: domain.ArtifactStatusFinalized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("failed to create sqlmock: %v", err)
			}
			defer db.Close()

			tt.mock(mock)
			s := NewSQLRequirementArtifactStore(db)

			result, err := s.GetLatestByCaseID(context.Background(), tenantID, caseID)

			if (err != nil) != tt.wantErr {
				t.Fatalf("GetLatestByCaseID() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}

			if tt.wantNil {
				if result != nil {
					t.Fatalf("expected nil result, got %+v", result)
				}
				return
			}

			if result == nil {
				t.Fatal("expected non-nil result")
			}
			if result.Version != tt.wantVer {
				t.Errorf("Version = %d, want %d", result.Version, tt.wantVer)
			}
			if result.Status != tt.wantStatus {
				t.Errorf("Status = %q, want %q", result.Status, tt.wantStatus)
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestPqUUIDArrayScanner(t *testing.T) {
	tests := []struct {
		name    string
		input   any
		wantLen int
		wantErr bool
	}{
		{name: "nil input", input: nil, wantLen: 0, wantErr: false},
		{name: "empty braces", input: "{}", wantLen: 0, wantErr: false},
		{name: "empty string", input: "", wantLen: 0, wantErr: false},
		{
			name:    "single uuid",
			input:   "{" + uuid.New().String() + "}",
			wantLen: 1,
			wantErr: false,
		},
		{
			name:    "two uuids",
			input:   "{" + uuid.New().String() + "," + uuid.New().String() + "}",
			wantLen: 2,
			wantErr: false,
		},
		{
			name:    "invalid uuid",
			input:   "{not-a-uuid}",
			wantLen: 0,
			wantErr: true,
		},
		{
			name:    "bytes input",
			input:   []byte("{" + uuid.New().String() + "}"),
			wantLen: 1,
			wantErr: false,
		},
		{
			name:    "unsupported type",
			input:   42,
			wantLen: 0,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var s pqUUIDArrayScanner
			err := s.Scan(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Scan() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				got := s.Value()
				if len(got) != tt.wantLen {
					t.Errorf("Value() len = %d, want %d", len(got), tt.wantLen)
				}
			}
		})
	}
}
