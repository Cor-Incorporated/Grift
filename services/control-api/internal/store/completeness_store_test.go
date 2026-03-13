package store

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestSQLCompletenessStore_GetByCaseID(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()

	tests := []struct {
		name       string
		mock       func(sqlmock.Sqlmock)
		wantNil    bool
		wantErr    bool
		wantTopics []string
		wantStatus CompletenessStatus
		wantScore  float64
	}{
		{
			name: "happy path",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT .* FROM completeness_tracking`).
					WithArgs(tenantID, caseID).
					WillReturnRows(
						sqlmock.NewRows([]string{"checklist", "overall_completeness", "suggested_next_topics"}).
							AddRow(
								`{"budget":{"status":"partial","confidence":0.5},"tech_stack":{"status":"collected","confidence":1}}`,
								0.6,
								"{budget,timeline}",
							),
					)
			},
			wantTopics: []string{"budget", "timeline"},
			wantStatus: StatusPartial,
			wantScore:  0.6,
		},
		{
			name: "not found",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT .* FROM completeness_tracking`).
					WithArgs(tenantID, caseID).
					WillReturnRows(sqlmock.NewRows([]string{"checklist", "overall_completeness", "suggested_next_topics"}))
			},
			wantNil: true,
		},
		{
			name: "query error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT .* FROM completeness_tracking`).
					WithArgs(tenantID, caseID).
					WillReturnError(errors.New("db down"))
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

			tt.mock(mock)

			s := NewSQLCompletenessStore(db)
			got, err := s.GetByCaseID(context.Background(), tenantID, caseID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("GetByCaseID() error = %v, wantErr %v", err, tt.wantErr)
			}

			if tt.wantNil {
				if got != nil {
					t.Fatalf("GetByCaseID() expected nil, got %+v", got)
				}
				return
			}
			if tt.wantErr {
				return
			}

			if got == nil {
				t.Fatal("GetByCaseID() returned nil")
			}
			if got.OverallCompleteness != tt.wantScore {
				t.Fatalf("OverallCompleteness = %v, want %v", got.OverallCompleteness, tt.wantScore)
			}
			if got.Checklist["budget"].Status != tt.wantStatus {
				t.Fatalf("Checklist[budget].Status = %q, want %q", got.Checklist["budget"].Status, tt.wantStatus)
			}
			if len(got.SuggestedNextTopics) != len(tt.wantTopics) {
				t.Fatalf("len(SuggestedNextTopics) = %d, want %d", len(got.SuggestedNextTopics), len(tt.wantTopics))
			}
			for i, topic := range tt.wantTopics {
				if got.SuggestedNextTopics[i] != topic {
					t.Fatalf("SuggestedNextTopics[%d] = %q, want %q", i, got.SuggestedNextTopics[i], topic)
				}
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSQLCompletenessStore_GetByCaseID_InvalidChecklistJSON(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT .* FROM completeness_tracking`).
		WithArgs(tenantID, caseID).
		WillReturnRows(
			sqlmock.NewRows([]string{"checklist", "overall_completeness", "suggested_next_topics"}).
				AddRow(`{`, 0.2, "{}"),
		)

	s := NewSQLCompletenessStore(db)
	_, err = s.GetByCaseID(context.Background(), tenantID, caseID)
	if err == nil {
		t.Fatal("GetByCaseID() expected error for invalid checklist JSON")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}
