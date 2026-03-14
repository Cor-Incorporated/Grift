package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestSQLProposalStoreCreate(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()
	proposalID := uuid.New()

	tests := []struct {
		name    string
		setup   func(sqlmock.Sqlmock)
		wantErr bool
	}{
		{
			name: "success",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`INSERT INTO proposal_sessions`).
					WithArgs(proposalID, tenantID, caseID, estimateID, domain.ProposalStatusDraft, nil, nil).
					WillReturnRows(sqlmock.NewRows([]string{"created_at", "updated_at"}).AddRow(now, now))
			},
		},
		{
			name: "insert error",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`INSERT INTO proposal_sessions`).
					WithArgs(proposalID, tenantID, caseID, estimateID, domain.ProposalStatusDraft, nil, nil).
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

			store := NewSQLProposalStore(db)
			proposal := &domain.ProposalSession{
				ID:         proposalID,
				TenantID:   tenantID,
				CaseID:     caseID,
				EstimateID: estimateID,
				Status:     domain.ProposalStatusDraft,
			}

			got, err := store.Create(context.Background(), tenantID, proposal)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Create() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				if got.CreatedAt != now {
					t.Fatalf("Create() created_at = %v, want %v", got.CreatedAt, now)
				}
				if got.UpdatedAt != now {
					t.Fatalf("Create() updated_at = %v, want %v", got.UpdatedAt, now)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLProposalStoreGetByID(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()
	proposalID := uuid.New()

	tests := []struct {
		name       string
		setup      func(sqlmock.Sqlmock)
		wantNil    bool
		wantErr    bool
		wantStatus domain.ProposalStatus
	}{
		{
			name: "success",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT id, tenant_id, case_id, estimate_id, status, presented_at, decided_at, created_at, updated_at`).
					WithArgs(tenantID, proposalID).
					WillReturnRows(sqlmock.NewRows([]string{
						"id", "tenant_id", "case_id", "estimate_id", "status", "presented_at", "decided_at", "created_at", "updated_at",
					}).AddRow(proposalID, tenantID, caseID, estimateID, domain.ProposalStatusPresented, now, nil, now, now))
			},
			wantStatus: domain.ProposalStatusPresented,
		},
		{
			name: "not found",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT id, tenant_id, case_id, estimate_id, status, presented_at, decided_at, created_at, updated_at`).
					WithArgs(tenantID, proposalID).
					WillReturnError(sql.ErrNoRows)
			},
			wantNil: true,
		},
		{
			name: "query error",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT id, tenant_id, case_id, estimate_id, status, presented_at, decided_at, created_at, updated_at`).
					WithArgs(tenantID, proposalID).
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

			store := NewSQLProposalStore(db)
			got, err := store.GetByID(context.Background(), tenantID, proposalID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("GetByID() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantNil {
				if got != nil {
					t.Fatalf("GetByID() = %+v, want nil", got)
				}
			} else if !tt.wantErr {
				if got == nil {
					t.Fatal("GetByID() returned nil")
				}
				if got.Status != tt.wantStatus {
					t.Fatalf("GetByID() status = %q, want %q", got.Status, tt.wantStatus)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLProposalStoreList(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	caseID := uuid.New()
	estimateID := uuid.New()
	proposalID := uuid.New()

	tests := []struct {
		name      string
		setup     func(sqlmock.Sqlmock)
		wantTotal int
		wantLen   int
		wantErr   bool
	}{
		{
			name: "success",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT COUNT\(\*\) FROM proposal_sessions`).
					WithArgs(tenantID, caseID).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				mock.ExpectQuery(`SELECT id, tenant_id, case_id, estimate_id, status, presented_at, decided_at, created_at, updated_at`).
					WithArgs(tenantID, caseID, 20, 0).
					WillReturnRows(sqlmock.NewRows([]string{
						"id", "tenant_id", "case_id", "estimate_id", "status", "presented_at", "decided_at", "created_at", "updated_at",
					}).AddRow(proposalID, tenantID, caseID, estimateID, domain.ProposalStatusDraft, nil, nil, now, now))
			},
			wantTotal: 1,
			wantLen:   1,
		},
		{
			name: "count error",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT COUNT\(\*\) FROM proposal_sessions`).
					WithArgs(tenantID, caseID).
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

			store := NewSQLProposalStore(db)
			got, total, err := store.List(context.Background(), tenantID, caseID, 20, 0)
			if (err != nil) != tt.wantErr {
				t.Fatalf("List() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				if total != tt.wantTotal {
					t.Fatalf("List() total = %d, want %d", total, tt.wantTotal)
				}
				if len(got) != tt.wantLen {
					t.Fatalf("List() len = %d, want %d", len(got), tt.wantLen)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLProposalStoreUpdateStatusIfNotDecided(t *testing.T) {
	tenantID := uuid.New()
	proposalID := uuid.New()
	decidedAt := time.Now().UTC().Truncate(time.Second)

	tests := []struct {
		name    string
		setup   func(sqlmock.Sqlmock)
		wantErr error
	}{
		{
			name: "success",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec(`UPDATE proposal_sessions`).
					WithArgs(domain.ProposalStatusApproved, &decidedAt, tenantID, proposalID).
					WillReturnResult(sqlmock.NewResult(0, 1))
			},
		},
		{
			name: "already decided",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec(`UPDATE proposal_sessions`).
					WithArgs(domain.ProposalStatusApproved, &decidedAt, tenantID, proposalID).
					WillReturnResult(sqlmock.NewResult(0, 0))
			},
			wantErr: ErrAlreadyDecided,
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

			store := NewSQLProposalStore(db)
			err = store.UpdateStatusIfNotDecided(context.Background(), tenantID, proposalID, domain.ProposalStatusApproved, &decidedAt)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("UpdateStatusIfNotDecided() error = %v, want %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLProposalStoreApprovalDecisions(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	proposalID := uuid.New()
	decisionID := uuid.New()
	role := "owner"
	comment := "looks good"

	tests := []struct {
		name          string
		runCreate     bool
		setup         func(sqlmock.Sqlmock)
		wantErr       bool
		wantCreatedAt time.Time
		wantListLen   int
	}{
		{
			name:      "create success",
			runCreate: true,
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`INSERT INTO approval_decisions`).
					WithArgs(decisionID, tenantID, proposalID, domain.DecisionApproved, "uid-1", &role, &comment, now).
					WillReturnRows(sqlmock.NewRows([]string{"created_at"}).AddRow(now))
			},
			wantCreatedAt: now,
		},
		{
			name: "list success",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`SELECT id, tenant_id, proposal_id, decision, decided_by_uid, decided_by_role, comment, decided_at, created_at`).
					WithArgs(tenantID, proposalID).
					WillReturnRows(sqlmock.NewRows([]string{
						"id", "tenant_id", "proposal_id", "decision", "decided_by_uid", "decided_by_role", "comment", "decided_at", "created_at",
					}).AddRow(decisionID, tenantID, proposalID, domain.DecisionApproved, "uid-1", role, comment, now, now))
			},
			wantListLen: 1,
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

			store := NewSQLProposalStore(db)
			if tt.runCreate {
				got, err := store.CreateApprovalDecision(context.Background(), tenantID, &domain.ApprovalDecision{
					ID:            decisionID,
					ProposalID:    proposalID,
					Decision:      domain.DecisionApproved,
					DecidedByUID:  "uid-1",
					DecidedByRole: &role,
					Comment:       &comment,
					DecidedAt:     now,
				})
				if (err != nil) != tt.wantErr {
					t.Fatalf("CreateApprovalDecision() error = %v, wantErr %v", err, tt.wantErr)
				}
				if err == nil && got.CreatedAt != tt.wantCreatedAt {
					t.Fatalf("CreateApprovalDecision() created_at = %v, want %v", got.CreatedAt, tt.wantCreatedAt)
				}
			} else {
				got, err := store.ListApprovalDecisions(context.Background(), tenantID, proposalID)
				if (err != nil) != tt.wantErr {
					t.Fatalf("ListApprovalDecisions() error = %v, wantErr %v", err, tt.wantErr)
				}
				if err == nil && len(got) != tt.wantListLen {
					t.Fatalf("ListApprovalDecisions() len = %d, want %d", len(got), tt.wantListLen)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}
