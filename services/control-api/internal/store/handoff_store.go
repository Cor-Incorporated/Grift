package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/google/uuid"
)

// HandoffStore defines the persistence operations used by the handoff workflow.
type HandoffStore interface {
	Create(ctx context.Context, h *domain.HandoffPackage) (*domain.HandoffPackage, error)
	GetByCaseID(ctx context.Context, caseID uuid.UUID) (*domain.HandoffPackage, error)
	GetByIdempotencyKey(ctx context.Context, key uuid.UUID) (*domain.HandoffPackage, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status domain.HandoffStatus, errMsg *string) error
	CreateIssueMapping(ctx context.Context, m *domain.HandoffIssueMapping) (*domain.HandoffIssueMapping, error)
	ListIssueMappings(ctx context.Context, handoffID uuid.UUID) ([]domain.HandoffIssueMapping, error)
}

// SQLHandoffStore implements HandoffStore using PostgreSQL.
type SQLHandoffStore struct {
	db *sql.DB
}

// NewSQLHandoffStore creates a SQLHandoffStore backed by the given database.
func NewSQLHandoffStore(db *sql.DB) *SQLHandoffStore {
	if db == nil {
		panic("db must not be nil")
	}
	return &SQLHandoffStore{db: db}
}

func (s *SQLHandoffStore) executor(ctx context.Context) dbExecutor {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return s.db
}

// Create inserts a new handoff package row and returns server-populated fields.
func (s *SQLHandoffStore) Create(ctx context.Context, h *domain.HandoffPackage) (*domain.HandoffPackage, error) {
	row := s.executor(ctx).QueryRowContext(
		ctx,
		`INSERT INTO handoff_packages (
			id, tenant_id, case_id, estimate_id, linear_project_id, linear_project_url,
			github_project_url, status, error_message, idempotency_key
		) VALUES (
			$1, NULLIF(current_setting('app.tenant_id', true), '')::uuid, $2, $3, $4, $5,
			$6, $7, $8, $9
		)
		RETURNING tenant_id, created_at, updated_at`,
		h.ID,
		h.CaseID,
		h.EstimateID,
		h.LinearProjectID,
		h.LinearProjectURL,
		h.GithubProjectURL,
		h.Status,
		h.ErrorMessage,
		h.IdempotencyKey,
	)
	if err := row.Scan(&h.TenantID, &h.CreatedAt, &h.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert handoff package: %w", err)
	}
	return h, nil
}

// GetByCaseID returns the latest handoff package for a case.
func (s *SQLHandoffStore) GetByCaseID(ctx context.Context, caseID uuid.UUID) (*domain.HandoffPackage, error) {
	row := s.executor(ctx).QueryRowContext(
		ctx,
		`SELECT id, tenant_id, case_id, estimate_id, linear_project_id, linear_project_url,
			github_project_url, status, error_message, idempotency_key, created_at, updated_at
		FROM handoff_packages
		WHERE case_id = $1
		ORDER BY created_at DESC
		LIMIT 1`,
		caseID,
	)
	record, err := scanHandoffPackage(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get handoff package by case: %w", err)
	}
	return record, nil
}

// GetByIdempotencyKey returns a handoff package by idempotency key.
func (s *SQLHandoffStore) GetByIdempotencyKey(ctx context.Context, key uuid.UUID) (*domain.HandoffPackage, error) {
	row := s.executor(ctx).QueryRowContext(
		ctx,
		`SELECT id, tenant_id, case_id, estimate_id, linear_project_id, linear_project_url,
			github_project_url, status, error_message, idempotency_key, created_at, updated_at
		FROM handoff_packages
		WHERE idempotency_key = $1`,
		key,
	)
	record, err := scanHandoffPackage(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get handoff package by idempotency key: %w", err)
	}
	return record, nil
}

// UpdateStatus updates the handoff status and optional error message.
func (s *SQLHandoffStore) UpdateStatus(ctx context.Context, id uuid.UUID, status domain.HandoffStatus, errMsg *string) error {
	result, err := s.executor(ctx).ExecContext(
		ctx,
		`UPDATE handoff_packages
		SET status = $1, error_message = $2, updated_at = NOW()
		WHERE id = $3`,
		status,
		errMsg,
		id,
	)
	if err != nil {
		return fmt.Errorf("update handoff status: %w", err)
	}
	return ensureRowsAffected(result, "update handoff status")
}

// CreateIssueMapping inserts a new handoff issue mapping row.
func (s *SQLHandoffStore) CreateIssueMapping(ctx context.Context, m *domain.HandoffIssueMapping) (*domain.HandoffIssueMapping, error) {
	row := s.executor(ctx).QueryRowContext(
		ctx,
		`INSERT INTO handoff_issue_mappings (
			id, tenant_id, handoff_id, module_name, phase_name, linear_issue_id,
			linear_issue_identifier, linear_issue_url, github_issue_number,
			github_issue_url, hours_estimate, source_event_id
		) VALUES (
			$1, NULLIF(current_setting('app.tenant_id', true), '')::uuid, $2, $3, $4, $5,
			$6, $7, $8, $9, $10, $11
		)
		RETURNING tenant_id, created_at, updated_at`,
		m.ID,
		m.HandoffID,
		m.ModuleName,
		m.PhaseName,
		m.LinearIssueID,
		m.LinearIssueIdentifier,
		m.LinearIssueURL,
		m.GithubIssueNumber,
		m.GithubIssueURL,
		m.HoursEstimate,
		m.SourceEventID,
	)
	if err := row.Scan(&m.TenantID, &m.CreatedAt, &m.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert handoff issue mapping: %w", err)
	}
	return m, nil
}

// ListIssueMappings returns issue mappings for a handoff package.
func (s *SQLHandoffStore) ListIssueMappings(ctx context.Context, handoffID uuid.UUID) ([]domain.HandoffIssueMapping, error) {
	rows, err := s.executor(ctx).QueryContext(
		ctx,
		`SELECT id, tenant_id, handoff_id, module_name, phase_name, linear_issue_id,
			linear_issue_identifier, linear_issue_url, github_issue_number,
			github_issue_url, hours_estimate, source_event_id, created_at, updated_at
		FROM handoff_issue_mappings
		WHERE handoff_id = $1
		ORDER BY created_at ASC`,
		handoffID,
	)
	if err != nil {
		return nil, fmt.Errorf("list handoff issue mappings: %w", err)
	}
	defer rows.Close()

	records := make([]domain.HandoffIssueMapping, 0)
	for rows.Next() {
		record, scanErr := scanHandoffIssueMapping(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		records = append(records, *record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate handoff issue mappings: %w", err)
	}
	return records, nil
}

func scanHandoffPackage(scanner rowScanner) (*domain.HandoffPackage, error) {
	var (
		record           domain.HandoffPackage
		linearProjectID  sql.NullString
		linearProjectURL sql.NullString
		githubProjectURL sql.NullString
		errorMessage     sql.NullString
	)

	if err := scanner.Scan(
		&record.ID,
		&record.TenantID,
		&record.CaseID,
		&record.EstimateID,
		&linearProjectID,
		&linearProjectURL,
		&githubProjectURL,
		&record.Status,
		&errorMessage,
		&record.IdempotencyKey,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return nil, err
	}

	record.LinearProjectID = nullStringPtr(linearProjectID)
	record.LinearProjectURL = nullStringPtr(linearProjectURL)
	record.GithubProjectURL = nullStringPtr(githubProjectURL)
	record.ErrorMessage = nullStringPtr(errorMessage)
	return &record, nil
}

func scanHandoffIssueMapping(scanner rowScanner) (*domain.HandoffIssueMapping, error) {
	var (
		record                domain.HandoffIssueMapping
		phaseName             sql.NullString
		linearIssueID         sql.NullString
		linearIssueIdentifier sql.NullString
		linearIssueURL        sql.NullString
		githubIssueNumber     sql.NullInt64
		githubIssueURL        sql.NullString
		hoursEstimate         sql.NullFloat64
		sourceEventID         sql.NullString
	)

	if err := scanner.Scan(
		&record.ID,
		&record.TenantID,
		&record.HandoffID,
		&record.ModuleName,
		&phaseName,
		&linearIssueID,
		&linearIssueIdentifier,
		&linearIssueURL,
		&githubIssueNumber,
		&githubIssueURL,
		&hoursEstimate,
		&sourceEventID,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return nil, err
	}

	record.PhaseName = nullStringPtr(phaseName)
	record.LinearIssueID = nullStringPtr(linearIssueID)
	record.LinearIssueIdentifier = nullStringPtr(linearIssueIdentifier)
	record.LinearIssueURL = nullStringPtr(linearIssueURL)
	record.GithubIssueURL = nullStringPtr(githubIssueURL)
	record.SourceEventID = nullStringPtr(sourceEventID)
	if githubIssueNumber.Valid {
		value := int(githubIssueNumber.Int64)
		record.GithubIssueNumber = &value
	}
	if hoursEstimate.Valid {
		record.HoursEstimate = &hoursEstimate.Float64
	}
	return &record, nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func ensureRowsAffected(result sql.Result, action string) error {
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s rows affected: %w", action, err)
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}
