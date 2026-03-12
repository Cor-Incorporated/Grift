package store

import (
	"context"
	"database/sql"
	"fmt"

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
