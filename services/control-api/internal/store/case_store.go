package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/google/uuid"
)

// CaseStore defines the persistence operations for cases.
type CaseStore interface {
	// Create inserts a new case and returns it with server-generated fields populated.
	Create(ctx context.Context, c *domain.Case) (*domain.Case, error)
	// List returns cases for a tenant with pagination and optional filters.
	List(ctx context.Context, tenantID uuid.UUID, statusFilter, typeFilter string, limit, offset int) ([]domain.Case, int, error)
	// Get returns a single case by ID scoped to a tenant. Returns nil if not found.
	Get(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error)
	// Update patches the specified fields on a case and returns the updated row.
	// Returns nil, sql.ErrNoRows if the case does not exist.
	Update(ctx context.Context, tenantID, caseID uuid.UUID, fields UpdateCaseFields) (*domain.Case, error)
	// Delete removes a case by ID scoped to a tenant.
	// Returns sql.ErrNoRows if the case does not exist.
	Delete(ctx context.Context, tenantID, caseID uuid.UUID) error
	// TransitionStatus atomically transitions a case from one status to another.
	// Returns true if the row was updated (i.e. the current status matched 'from').
	TransitionStatus(ctx context.Context, tenantID, caseID uuid.UUID, from, to domain.CaseStatus) (bool, error)
}

// UpdateCaseFields holds the optional fields that may be patched on a case.
// Only non-nil fields are applied.
type UpdateCaseFields struct {
	Title    *string
	Type     *domain.CaseType
	Status   *domain.CaseStatus
	Priority *domain.CasePriority
}

// dbExecutor abstracts *sql.DB and *sql.Tx for query execution.
type dbExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// SQLCaseStore implements CaseStore using a SQL database.
type SQLCaseStore struct {
	db *sql.DB
}

// NewSQLCaseStore creates a new SQLCaseStore backed by the given database.
func NewSQLCaseStore(db *sql.DB) *SQLCaseStore {
	return &SQLCaseStore{db: db}
}

// executor returns the RLS-scoped transaction from context if available, otherwise the pool.
func (s *SQLCaseStore) executor(ctx context.Context) dbExecutor {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return s.db
}

// Create inserts a new case row and returns the case with server-generated timestamps.
func (s *SQLCaseStore) Create(ctx context.Context, c *domain.Case) (*domain.Case, error) {
	exec := s.executor(ctx)

	row := exec.QueryRowContext(ctx,
		`INSERT INTO cases (
			id, tenant_id, title, type, status,
			existing_system_url, company_name, contact_name, contact_email, created_by_uid
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING created_at, updated_at`,
		c.ID, c.TenantID, c.Title, c.Type, c.Status,
		c.ExistingSystemURL, c.CompanyName, c.ContactName, c.ContactEmail, c.CreatedByUID,
	)
	if err := row.Scan(&c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert case: %w", err)
	}

	return c, nil
}

// List returns cases for a tenant with optional status and type filters.
func (s *SQLCaseStore) List(ctx context.Context, tenantID uuid.UUID, statusFilter, typeFilter string, limit, offset int) ([]domain.Case, int, error) {
	exec := s.executor(ctx)

	query := `SELECT id, tenant_id, title, type, status, priority, business_line,
		existing_system_url, spec_markdown, contact_name, contact_email,
		company_name, created_by_uid, created_at, updated_at
		FROM cases WHERE tenant_id = $1`
	countQuery := `SELECT COUNT(*) FROM cases WHERE tenant_id = $1`
	args := []any{tenantID}

	if statusFilter != "" && domain.CaseStatus(statusFilter).IsValid() {
		query += fmt.Sprintf(" AND status = $%d", len(args)+1)
		countQuery += fmt.Sprintf(" AND status = $%d", len(args)+1)
		args = append(args, statusFilter)
	}
	if typeFilter != "" && domain.CaseType(typeFilter).IsValid() {
		query += fmt.Sprintf(" AND type = $%d", len(args)+1)
		countQuery += fmt.Sprintf(" AND type = $%d", len(args)+1)
		args = append(args, typeFilter)
	}

	var total int
	if err := exec.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count cases: %w", err)
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, limit, offset)

	rows, err := exec.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list cases: %w", err)
	}
	defer rows.Close()

	var records []domain.Case
	for rows.Next() {
		record, err := scanCase(rows)
		if err != nil {
			return nil, 0, err
		}
		records = append(records, *record)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate cases: %w", err)
	}

	return records, total, nil
}

// Get retrieves a single case by ID, scoped to a tenant. Returns nil if not found.
func (s *SQLCaseStore) Get(ctx context.Context, tenantID, caseID uuid.UUID) (*domain.Case, error) {
	exec := s.executor(ctx)

	row := exec.QueryRowContext(ctx,
		`SELECT id, tenant_id, title, type, status, priority, business_line,
			existing_system_url, spec_markdown, contact_name, contact_email,
			company_name, created_by_uid, created_at, updated_at
		FROM cases
		WHERE tenant_id = $1 AND id = $2`,
		tenantID, caseID,
	)

	record, err := scanCase(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get case: %w", err)
	}

	return record, nil
}

// rowScanner abstracts *sql.Row and *sql.Rows for scanning.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanCase scans a case row into a domain.Case, handling nullable priority.
func scanCase(scanner rowScanner) (*domain.Case, error) {
	var record domain.Case
	var priority sql.NullString
	if err := scanner.Scan(
		&record.ID,
		&record.TenantID,
		&record.Title,
		&record.Type,
		&record.Status,
		&priority,
		&record.BusinessLine,
		&record.ExistingSystemURL,
		&record.SpecMarkdown,
		&record.ContactName,
		&record.ContactEmail,
		&record.CompanyName,
		&record.CreatedByUID,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if priority.Valid {
		value := domain.CasePriority(priority.String)
		record.Priority = &value
	}
	return &record, nil
}

// Update patches the specified non-nil fields on a case and returns the updated row.
// Returns nil, sql.ErrNoRows when no matching row exists.
func (s *SQLCaseStore) Update(ctx context.Context, tenantID, caseID uuid.UUID, fields UpdateCaseFields) (*domain.Case, error) {
	exec := s.executor(ctx)

	// tenant_id and id are always the first two parameters.
	args := []any{tenantID, caseID}
	var setClauses []string

	if fields.Title != nil {
		args = append(args, *fields.Title)
		setClauses = append(setClauses, fmt.Sprintf("title = $%d", len(args)))
	}
	if fields.Type != nil {
		args = append(args, string(*fields.Type))
		setClauses = append(setClauses, fmt.Sprintf("type = $%d", len(args)))
	}
	if fields.Status != nil {
		args = append(args, string(*fields.Status))
		setClauses = append(setClauses, fmt.Sprintf("status = $%d", len(args)))
	}
	if fields.Priority != nil {
		args = append(args, string(*fields.Priority))
		setClauses = append(setClauses, fmt.Sprintf("priority = $%d", len(args)))
	}

	if len(setClauses) == 0 {
		// Nothing to update; just return the current row.
		return s.Get(ctx, tenantID, caseID)
	}

	// Always bump updated_at.
	setClauses = append(setClauses, "updated_at = NOW()")

	query := fmt.Sprintf(
		`UPDATE cases SET %s WHERE tenant_id = $1 AND id = $2
		RETURNING id, tenant_id, title, type, status, priority, business_line,
			existing_system_url, spec_markdown, contact_name, contact_email,
			company_name, created_by_uid, created_at, updated_at`,
		strings.Join(setClauses, ", "),
	)

	row := exec.QueryRowContext(ctx, query, args...)
	record, err := scanCase(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, sql.ErrNoRows
		}
		return nil, fmt.Errorf("update case: %w", err)
	}

	return record, nil
}

// Delete removes a case by tenant and case ID.
// Returns sql.ErrNoRows when no matching row exists.
func (s *SQLCaseStore) Delete(ctx context.Context, tenantID, caseID uuid.UUID) error {
	exec := s.executor(ctx)

	result, err := exec.ExecContext(ctx,
		`DELETE FROM cases WHERE tenant_id = $1 AND id = $2`,
		tenantID, caseID,
	)
	if err != nil {
		return fmt.Errorf("delete case: %w", err)
	}

	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete case rows affected: %w", err)
	}
	if n == 0 {
		return sql.ErrNoRows
	}

	return nil
}

// TransitionStatus atomically updates a case's status from 'from' to 'to'.
// The conditional WHERE clause makes this idempotent and race-safe.
func (s *SQLCaseStore) TransitionStatus(ctx context.Context, tenantID, caseID uuid.UUID, from, to domain.CaseStatus) (bool, error) {
	exec := s.executor(ctx)
	result, err := exec.ExecContext(ctx,
		`UPDATE cases SET status = $3, updated_at = NOW()
		 WHERE tenant_id = $1 AND id = $2 AND status = $4`,
		tenantID, caseID, string(to), string(from),
	)
	if err != nil {
		return false, fmt.Errorf("transition case status: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("transition case status rows affected: %w", err)
	}
	return n > 0, nil
}
