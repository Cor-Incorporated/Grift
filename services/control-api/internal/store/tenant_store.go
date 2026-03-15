package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/google/uuid"
)

// TenantStore defines the persistence operations for tenants and their members.
type TenantStore interface {
	// Create inserts a new tenant and returns it with server-generated fields populated.
	Create(ctx context.Context, t *domain.Tenant) (*domain.Tenant, error)
	// List returns tenants with pagination.
	List(ctx context.Context, limit, offset int) ([]domain.Tenant, int, error)
	// GetByID returns a single tenant by ID. Returns nil if not found.
	GetByID(ctx context.Context, tenantID uuid.UUID) (*domain.Tenant, error)
	// UpdateSettings applies a partial settings update to a tenant.
	UpdateSettings(ctx context.Context, tenantID uuid.UUID, analyticsOptIn, trainingOptIn *bool, settings json.RawMessage) (*domain.Tenant, error)
	// AddMember inserts a new tenant member and returns it with server-generated fields.
	AddMember(ctx context.Context, m *domain.TenantMember) (*domain.TenantMember, error)
	// ListMembers returns members for a tenant with pagination.
	ListMembers(ctx context.Context, tenantID uuid.UUID, limit, offset int) ([]domain.TenantMember, int, error)
	// GetMemberByFirebaseUID returns the active member for a tenant by Firebase UID.
	// Returns nil if no active membership exists.
	GetMemberByFirebaseUID(ctx context.Context, tenantID uuid.UUID, firebaseUID string) (*domain.TenantMember, error)
}

// SQLTenantStore implements TenantStore using a SQL database.
type SQLTenantStore struct {
	db *sql.DB
}

// NewSQLTenantStore creates a new SQLTenantStore backed by the given database.
func NewSQLTenantStore(db *sql.DB) *SQLTenantStore {
	return &SQLTenantStore{db: db}
}

// executor returns the RLS-scoped transaction from context if available, otherwise the pool.
func (s *SQLTenantStore) executor(ctx context.Context) dbExecutor {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return s.db
}

// Create inserts a new tenant row and returns it with server-generated timestamps.
func (s *SQLTenantStore) Create(ctx context.Context, t *domain.Tenant) (*domain.Tenant, error) {
	exec := s.executor(ctx)

	row := exec.QueryRowContext(ctx,
		`INSERT INTO tenants (id, name, slug, plan, settings, analytics_opt_in, training_opt_in)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at, updated_at`,
		t.ID, t.Name, t.Slug, t.Plan, t.Settings, t.AnalyticsOptIn, t.TrainingOptIn,
	)
	if err := row.Scan(&t.CreatedAt, &t.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert tenant: %w", err)
	}

	return t, nil
}

// List returns tenants with pagination.
func (s *SQLTenantStore) List(ctx context.Context, limit, offset int) ([]domain.Tenant, int, error) {
	exec := s.executor(ctx)

	var total int
	if err := exec.QueryRowContext(ctx, `SELECT COUNT(*) FROM tenants`).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count tenants: %w", err)
	}

	rows, err := exec.QueryContext(ctx,
		`SELECT id, name, slug, plan, settings, analytics_opt_in, training_opt_in, created_at, updated_at
		FROM tenants ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
		limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list tenants: %w", err)
	}
	defer rows.Close()

	var records []domain.Tenant
	for rows.Next() {
		record, err := scanTenant(rows)
		if err != nil {
			return nil, 0, err
		}
		records = append(records, *record)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate tenants: %w", err)
	}

	return records, total, nil
}

// GetByID retrieves a single tenant by ID. Returns nil if not found.
func (s *SQLTenantStore) GetByID(ctx context.Context, tenantID uuid.UUID) (*domain.Tenant, error) {
	exec := s.executor(ctx)

	row := exec.QueryRowContext(ctx,
		`SELECT id, name, slug, plan, settings, analytics_opt_in, training_opt_in, created_at, updated_at
		FROM tenants WHERE id = $1`,
		tenantID,
	)

	record, err := scanTenant(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get tenant: %w", err)
	}

	return record, nil
}

// UpdateSettings applies a partial update to tenant settings and opt-in flags.
func (s *SQLTenantStore) UpdateSettings(ctx context.Context, tenantID uuid.UUID, analyticsOptIn, trainingOptIn *bool, settings json.RawMessage) (*domain.Tenant, error) {
	exec := s.executor(ctx)

	// Build dynamic SET clause for partial update.
	query := `UPDATE tenants SET updated_at = now()`
	args := []any{}
	argIdx := 1

	if analyticsOptIn != nil {
		query += fmt.Sprintf(", analytics_opt_in = $%d", argIdx)
		args = append(args, *analyticsOptIn)
		argIdx++
	}
	if trainingOptIn != nil {
		query += fmt.Sprintf(", training_opt_in = $%d", argIdx)
		args = append(args, *trainingOptIn)
		argIdx++
	}
	if settings != nil {
		query += fmt.Sprintf(", settings = $%d", argIdx)
		args = append(args, settings)
		argIdx++
	}

	query += fmt.Sprintf(` WHERE id = $%d
		RETURNING id, name, slug, plan, settings, analytics_opt_in, training_opt_in, created_at, updated_at`, argIdx)
	args = append(args, tenantID)

	row := exec.QueryRowContext(ctx, query, args...)
	record, err := scanTenant(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("update tenant settings: %w", err)
	}

	return record, nil
}

// AddMember inserts a new tenant member and returns it with server-generated fields.
func (s *SQLTenantStore) AddMember(ctx context.Context, m *domain.TenantMember) (*domain.TenantMember, error) {
	exec := s.executor(ctx)

	row := exec.QueryRowContext(ctx,
		`INSERT INTO tenant_members (id, tenant_id, firebase_uid, email, display_name, role, active)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at, updated_at`,
		m.ID, m.TenantID, m.FirebaseUID, m.Email, m.DisplayName, m.Role, m.Active,
	)
	if err := row.Scan(&m.CreatedAt, &m.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert tenant member: %w", err)
	}

	return m, nil
}

// ListMembers returns members for a tenant with pagination.
func (s *SQLTenantStore) ListMembers(ctx context.Context, tenantID uuid.UUID, limit, offset int) ([]domain.TenantMember, int, error) {
	exec := s.executor(ctx)

	var total int
	if err := exec.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM tenant_members WHERE tenant_id = $1`, tenantID,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count tenant members: %w", err)
	}

	rows, err := exec.QueryContext(ctx,
		`SELECT id, tenant_id, firebase_uid, email, display_name, role, active, created_at, updated_at
		FROM tenant_members WHERE tenant_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		tenantID, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list tenant members: %w", err)
	}
	defer rows.Close()

	var records []domain.TenantMember
	for rows.Next() {
		record, err := scanTenantMember(rows)
		if err != nil {
			return nil, 0, err
		}
		records = append(records, *record)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate tenant members: %w", err)
	}

	return records, total, nil
}

// GetMemberByFirebaseUID returns the active member for a tenant by Firebase UID.
func (s *SQLTenantStore) GetMemberByFirebaseUID(ctx context.Context, tenantID uuid.UUID, firebaseUID string) (*domain.TenantMember, error) {
	exec := s.executor(ctx)

	row := exec.QueryRowContext(ctx,
		`SELECT id, tenant_id, firebase_uid, email, display_name, role, active, created_at, updated_at
		FROM tenant_members WHERE tenant_id = $1 AND firebase_uid = $2 AND active = true`,
		tenantID, firebaseUID,
	)

	record, err := scanTenantMember(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get member by firebase uid: %w", err)
	}

	return record, nil
}

// scanTenant scans a tenant row into a domain.Tenant.
func scanTenant(scanner rowScanner) (*domain.Tenant, error) {
	var record domain.Tenant
	if err := scanner.Scan(
		&record.ID,
		&record.Name,
		&record.Slug,
		&record.Plan,
		&record.Settings,
		&record.AnalyticsOptIn,
		&record.TrainingOptIn,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &record, nil
}

// scanTenantMember scans a tenant member row into a domain.TenantMember.
func scanTenantMember(scanner rowScanner) (*domain.TenantMember, error) {
	var record domain.TenantMember
	if err := scanner.Scan(
		&record.ID,
		&record.TenantID,
		&record.FirebaseUID,
		&record.Email,
		&record.DisplayName,
		&record.Role,
		&record.Active,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &record, nil
}
