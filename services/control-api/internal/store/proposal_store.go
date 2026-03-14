package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

var activeCaseStatuses = []string{
	string(domain.CaseStatusInterviewing),
	string(domain.CaseStatusAnalyzing),
	string(domain.CaseStatusEstimating),
	string(domain.CaseStatusProposed),
}

// ErrAlreadyDecided is returned when a proposal status transition targets a decided proposal.
var ErrAlreadyDecided = errors.New("proposal already decided")

// ProposalStore defines the persistence operations used by the proposal workflow.
type ProposalStore interface {
	Create(ctx context.Context, tenantID uuid.UUID, proposal *domain.ProposalSession) (*domain.ProposalSession, error)
	List(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.ProposalSession, int, error)
	GetByID(ctx context.Context, tenantID, proposalID uuid.UUID) (*domain.ProposalSession, error)
	UpdateStatusIfNotDecided(ctx context.Context, tenantID, proposalID uuid.UUID, status domain.ProposalStatus, decidedAt *time.Time) error
	CreateApprovalDecision(ctx context.Context, tenantID uuid.UUID, decision *domain.ApprovalDecision) (*domain.ApprovalDecision, error)
	ListApprovalDecisions(ctx context.Context, tenantID, proposalID uuid.UUID) ([]domain.ApprovalDecision, error)
	GetCase(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error)
	GetMarketEvidence(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error)
	CountActiveCases(ctx context.Context, tenantID, excludeCaseID uuid.UUID) (int, error)
}

// SQLProposalStore implements ProposalStore using PostgreSQL.
type SQLProposalStore struct {
	db *sql.DB
}

// NewSQLProposalStore creates a SQLProposalStore backed by the given database.
func NewSQLProposalStore(db *sql.DB) *SQLProposalStore {
	if db == nil {
		panic("db must not be nil")
	}
	return &SQLProposalStore{db: db}
}

// Create inserts a new proposal session row and returns server-populated timestamps.
func (s *SQLProposalStore) Create(ctx context.Context, tenantID uuid.UUID, proposal *domain.ProposalSession) (*domain.ProposalSession, error) {
	row := executorFromContext(ctx, s.db).QueryRowContext(
		ctx,
		`INSERT INTO proposal_sessions (
			id, tenant_id, case_id, estimate_id, status, presented_at, decided_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at, updated_at`,
		proposal.ID,
		tenantID,
		proposal.CaseID,
		proposal.EstimateID,
		proposal.Status,
		proposal.PresentedAt,
		proposal.DecidedAt,
	)
	if err := row.Scan(&proposal.CreatedAt, &proposal.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert proposal session: %w", err)
	}
	proposal.TenantID = tenantID
	return proposal, nil
}

// List returns proposal sessions for a case with pagination.
func (s *SQLProposalStore) List(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.ProposalSession, int, error) {
	exec := executorFromContext(ctx, s.db)

	var total int
	if err := exec.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM proposal_sessions WHERE tenant_id = $1 AND case_id = $2`,
		tenantID,
		caseID,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count proposal sessions: %w", err)
	}

	rows, err := exec.QueryContext(
		ctx,
		`SELECT id, tenant_id, case_id, estimate_id, status, presented_at, decided_at, created_at, updated_at
		FROM proposal_sessions
		WHERE tenant_id = $1 AND case_id = $2
		ORDER BY created_at DESC
		LIMIT $3 OFFSET $4`,
		tenantID,
		caseID,
		limit,
		offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list proposal sessions: %w", err)
	}
	defer rows.Close()

	records := make([]domain.ProposalSession, 0)
	for rows.Next() {
		record, err := scanProposalSession(rows)
		if err != nil {
			return nil, 0, err
		}
		records = append(records, *record)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate proposal sessions: %w", err)
	}

	return records, total, nil
}

// GetByID returns a proposal session by its identifier.
func (s *SQLProposalStore) GetByID(ctx context.Context, tenantID, proposalID uuid.UUID) (*domain.ProposalSession, error) {
	row := executorFromContext(ctx, s.db).QueryRowContext(
		ctx,
		`SELECT id, tenant_id, case_id, estimate_id, status, presented_at, decided_at, created_at, updated_at
		FROM proposal_sessions
		WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		proposalID,
	)

	record, err := scanProposalSession(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get proposal session: %w", err)
	}
	return record, nil
}

// UpdateStatusIfNotDecided updates the status for a proposal that has not already been decided.
func (s *SQLProposalStore) UpdateStatusIfNotDecided(ctx context.Context, tenantID, proposalID uuid.UUID, status domain.ProposalStatus, decidedAt *time.Time) error {
	result, err := executorFromContext(ctx, s.db).ExecContext(
		ctx,
		`UPDATE proposal_sessions
		SET status = $1, decided_at = $2, updated_at = NOW()
		WHERE tenant_id = $3 AND id = $4
			AND status NOT IN ('approved', 'rejected')`,
		status,
		decidedAt,
		tenantID,
		proposalID,
	)
	if err != nil {
		return fmt.Errorf("update proposal status if not decided: %w", err)
	}

	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update proposal status if not decided rows affected: %w", err)
	}
	if n == 0 {
		return ErrAlreadyDecided
	}
	return nil
}

// CreateApprovalDecision inserts an approval decision row.
func (s *SQLProposalStore) CreateApprovalDecision(ctx context.Context, tenantID uuid.UUID, decision *domain.ApprovalDecision) (*domain.ApprovalDecision, error) {
	row := executorFromContext(ctx, s.db).QueryRowContext(
		ctx,
		`INSERT INTO approval_decisions (
			id, tenant_id, proposal_id, decision, decided_by_uid, decided_by_role, comment, decided_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING created_at`,
		decision.ID,
		tenantID,
		decision.ProposalID,
		decision.Decision,
		decision.DecidedByUID,
		decision.DecidedByRole,
		decision.Comment,
		decision.DecidedAt,
	)
	if err := row.Scan(&decision.CreatedAt); err != nil {
		return nil, fmt.Errorf("insert approval decision: %w", err)
	}
	decision.TenantID = tenantID
	return decision, nil
}

// ListApprovalDecisions returns approval decisions for a proposal session.
func (s *SQLProposalStore) ListApprovalDecisions(ctx context.Context, tenantID, proposalID uuid.UUID) ([]domain.ApprovalDecision, error) {
	rows, err := executorFromContext(ctx, s.db).QueryContext(
		ctx,
		`SELECT id, tenant_id, proposal_id, decision, decided_by_uid, decided_by_role, comment, decided_at, created_at
		FROM approval_decisions
		WHERE tenant_id = $1 AND proposal_id = $2
		ORDER BY decided_at DESC, created_at DESC`,
		tenantID,
		proposalID,
	)
	if err != nil {
		return nil, fmt.Errorf("list approval decisions: %w", err)
	}
	defer rows.Close()

	records := make([]domain.ApprovalDecision, 0)
	for rows.Next() {
		record, err := scanApprovalDecision(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, *record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate approval decisions: %w", err)
	}
	return records, nil
}

// GetCase returns a tenant-scoped case record.
func (s *SQLProposalStore) GetCase(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error) {
	row := executorFromContext(ctx, s.db).QueryRowContext(
		ctx,
		`SELECT id, tenant_id, title, type, status, priority, business_line,
			existing_system_url, spec_markdown, contact_name, contact_email,
			company_name, created_by_uid, created_at, updated_at
		FROM cases
		WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		caseID,
	)

	record, err := scanCase(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get case for proposal workflow: %w", err)
	}
	return record, nil
}

// GetMarketEvidence returns aggregated market evidence by identifier.
func (s *SQLProposalStore) GetMarketEvidence(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error) {
	return NewSQLMarketEvidenceStore(s.db).GetByID(ctx, tenantID, evidenceID)
}

// CountActiveCases returns the number of other active cases for the tenant.
func (s *SQLProposalStore) CountActiveCases(ctx context.Context, tenantID, excludeCaseID uuid.UUID) (int, error) {
	var total int
	if err := executorFromContext(ctx, s.db).QueryRowContext(
		ctx,
		`SELECT COUNT(*)
		FROM cases
		WHERE tenant_id = $1 AND id <> $2 AND status = ANY($3)`,
		tenantID,
		excludeCaseID,
		pq.Array(activeCaseStatuses),
	).Scan(&total); err != nil {
		return 0, fmt.Errorf("count active cases: %w", err)
	}
	return total, nil
}

func scanProposalSession(scanner rowScanner) (*domain.ProposalSession, error) {
	var (
		record      domain.ProposalSession
		presentedAt sql.NullTime
		decidedAt   sql.NullTime
	)

	if err := scanner.Scan(
		&record.ID,
		&record.TenantID,
		&record.CaseID,
		&record.EstimateID,
		&record.Status,
		&presentedAt,
		&decidedAt,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return nil, err
	}

	if presentedAt.Valid {
		record.PresentedAt = &presentedAt.Time
	}
	if decidedAt.Valid {
		record.DecidedAt = &decidedAt.Time
	}
	return &record, nil
}

func scanApprovalDecision(scanner rowScanner) (*domain.ApprovalDecision, error) {
	var (
		record        domain.ApprovalDecision
		decidedByRole sql.NullString
		comment       sql.NullString
	)

	if err := scanner.Scan(
		&record.ID,
		&record.TenantID,
		&record.ProposalID,
		&record.Decision,
		&record.DecidedByUID,
		&decidedByRole,
		&comment,
		&record.DecidedAt,
		&record.CreatedAt,
	); err != nil {
		return nil, err
	}

	if decidedByRole.Valid {
		record.DecidedByRole = &decidedByRole.String
	}
	if comment.Valid {
		record.Comment = &comment.String
	}
	return &record, nil
}
