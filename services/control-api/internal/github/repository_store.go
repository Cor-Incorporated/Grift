package github

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/google/uuid"
)

// ErrNotImplemented is returned when a method is defined in the interface
// but its implementation is not yet available (schema dependency missing).
var ErrNotImplemented = errors.New("not implemented")

// ListOptions controls pagination and filtering for repository listing.
type ListOptions struct {
	OrgName *string
	Limit   int
	Offset  int
}

// RepositoryStore persists repositories to the database.
type RepositoryStore interface {
	// UpsertRepository inserts or updates a repository based on (tenant_id, full_name).
	UpsertRepository(ctx context.Context, repo *domain.Repository) error
	// ListByTenant returns repositories for a tenant with optional filtering and pagination.
	ListByTenant(ctx context.Context, tenantID uuid.UUID, opts ListOptions) ([]domain.Repository, int, error)
	// GetByID returns a single repository by its primary key, scoped to the given tenant.
	GetByID(ctx context.Context, id uuid.UUID, tenantID uuid.UUID) (*domain.Repository, error)
	// FindNewAndArchived compares discovered GitHub IDs against existing records
	// for a tenant, returning IDs not yet stored and UUIDs of records no longer discovered.
	FindNewAndArchived(ctx context.Context, tenantID uuid.UUID, discovered []int64) (newIDs []int64, archivedIDs []uuid.UUID, err error)
}

// SQLRepositoryStore implements RepositoryStore using a *sql.DB connection pool.
type SQLRepositoryStore struct {
	DB *sql.DB
}

// UpsertRepository inserts a repository or updates it on conflict of (tenant_id, full_name).
func (s *SQLRepositoryStore) UpsertRepository(ctx context.Context, repo *domain.Repository) error {
	const query = `
		INSERT INTO repository_snapshots (
			id, tenant_id, installation_id, github_id,
			org_name, repo_name, full_name,
			description, language, stars, topics, tech_stack,
			total_commits, contributor_count,
			is_private, is_archived,
			synced_at, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7,
			$8, $9, $10, $11, $12,
			$13, $14,
			$15, $16,
			now(), now(), now()
		)
		ON CONFLICT (tenant_id, full_name) DO UPDATE SET
			installation_id   = EXCLUDED.installation_id,
			github_id         = EXCLUDED.github_id,
			org_name          = EXCLUDED.org_name,
			repo_name         = EXCLUDED.repo_name,
			description       = EXCLUDED.description,
			language          = EXCLUDED.language,
			stars             = EXCLUDED.stars,
			topics            = EXCLUDED.topics,
			total_commits     = EXCLUDED.total_commits,
			contributor_count = EXCLUDED.contributor_count,
			is_private        = EXCLUDED.is_private,
			is_archived       = EXCLUDED.is_archived,
			synced_at         = now(),
			updated_at        = now()
	`

	if repo.ID == uuid.Nil {
		repo.ID = uuid.New()
	}

	_, err := s.DB.ExecContext(ctx, query,
		repo.ID, repo.TenantID, repo.InstallationID, repo.GitHubID,
		repo.OrgName, repo.RepoName, repo.FullName,
		repo.Description, repo.Language, repo.Stars,
		pqStringArray(repo.Topics), pqStringArray(repo.TechStack),
		repo.TotalCommits, repo.ContributorCount,
		repo.IsPrivate, repo.IsArchived,
	)
	if err != nil {
		return fmt.Errorf("upserting repository %s: %w", repo.FullName, err)
	}
	return nil
}

// ListByTenant returns repositories for the given tenant with optional org_name filtering.
// It returns the matching repositories, a total count, and any error.
func (s *SQLRepositoryStore) ListByTenant(ctx context.Context, tenantID uuid.UUID, opts ListOptions) ([]domain.Repository, int, error) {
	limit := opts.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := opts.Offset
	if offset < 0 {
		offset = 0
	}

	var whereClauses []string
	var args []any
	argIdx := 1

	whereClauses = append(whereClauses, fmt.Sprintf("tenant_id = $%d", argIdx))
	args = append(args, tenantID)
	argIdx++

	if opts.OrgName != nil && *opts.OrgName != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("org_name = $%d", argIdx))
		args = append(args, *opts.OrgName)
		argIdx++
	}

	where := "WHERE " + strings.Join(whereClauses, " AND ")

	countQuery := "SELECT COUNT(*) FROM repository_snapshots " + where
	var total int
	if err := s.DB.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting repositories: %w", err)
	}

	selectQuery := fmt.Sprintf(`
		SELECT id, tenant_id, installation_id, github_id,
			org_name, repo_name, full_name,
			description, language, stars, topics, tech_stack,
			total_commits, contributor_count,
			is_private, is_archived,
			synced_at, created_at, updated_at
		FROM repository_snapshots
		%s
		ORDER BY full_name ASC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)

	args = append(args, limit, offset)

	rows, err := s.DB.QueryContext(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing repositories: %w", err)
	}
	defer rows.Close()

	var repos []domain.Repository
	for rows.Next() {
		var r domain.Repository
		var topics, techStack pqStringArrayScanner
		if err := rows.Scan(
			&r.ID, &r.TenantID, &r.InstallationID, &r.GitHubID,
			&r.OrgName, &r.RepoName, &r.FullName,
			&r.Description, &r.Language, &r.Stars, &topics, &techStack,
			&r.TotalCommits, &r.ContributorCount,
			&r.IsPrivate, &r.IsArchived,
			&r.SyncedAt, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scanning repository row: %w", err)
		}
		r.Topics = topics.Value()
		r.TechStack = techStack.Value()
		repos = append(repos, r)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterating repository rows: %w", err)
	}

	return repos, total, nil
}

// GetByID returns a single repository by its primary key, scoped to the given tenant.
// CRITICAL-2: The query filters by both id AND tenant_id to prevent IDOR.
func (s *SQLRepositoryStore) GetByID(ctx context.Context, id uuid.UUID, tenantID uuid.UUID) (*domain.Repository, error) {
	const query = `
		SELECT id, tenant_id, installation_id, github_id,
			org_name, repo_name, full_name,
			description, language, stars, topics, tech_stack,
			total_commits, contributor_count,
			is_private, is_archived,
			synced_at, created_at, updated_at
		FROM repository_snapshots
		WHERE id = $1 AND tenant_id = $2
	`

	var r domain.Repository
	var topics, techStack pqStringArrayScanner
	err := s.DB.QueryRowContext(ctx, query, id, tenantID).Scan(
		&r.ID, &r.TenantID, &r.InstallationID, &r.GitHubID,
		&r.OrgName, &r.RepoName, &r.FullName,
		&r.Description, &r.Language, &r.Stars, &topics, &techStack,
		&r.TotalCommits, &r.ContributorCount,
		&r.IsPrivate, &r.IsArchived,
		&r.SyncedAt, &r.CreatedAt, &r.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("getting repository %s: %w", id, err)
	}
	r.Topics = topics.Value()
	r.TechStack = techStack.Value()
	return &r, nil
}

// FindNewAndArchived compares discovered GitHub IDs against existing records
// for a tenant. It returns GitHub IDs not yet in the database (new) and
// database UUIDs of records whose GitHub ID is no longer in the discovered set (archived).
//
// HIGH-3: Returns ErrNotImplemented because the schema does not yet have a
// github_id column. When the column is added, this method should be implemented.
func (s *SQLRepositoryStore) FindNewAndArchived(_ context.Context, _ uuid.UUID, _ []int64) ([]int64, []uuid.UUID, error) {
	return nil, nil, ErrNotImplemented
}

// pqStringArray converts a Go string slice to a PostgreSQL text array literal.
func pqStringArray(ss []string) string {
	if len(ss) == 0 {
		return "{}"
	}
	var b strings.Builder
	b.WriteByte('{')
	for i, s := range ss {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('"')
		for _, c := range s {
			if c == '\\' || c == '"' {
				b.WriteByte('\\')
			}
			b.WriteRune(c)
		}
		b.WriteByte('"')
	}
	b.WriteByte('}')
	return b.String()
}

// pqStringArrayScanner scans a PostgreSQL text[] column into a Go string slice.
type pqStringArrayScanner struct {
	data []string
}

// Scan implements the sql.Scanner interface for PostgreSQL text[] columns.
func (s *pqStringArrayScanner) Scan(src any) error {
	if src == nil {
		s.data = nil
		return nil
	}

	var raw string
	switch v := src.(type) {
	case []byte:
		raw = string(v)
	case string:
		raw = v
	default:
		return fmt.Errorf("unsupported type for text[]: %T", src)
	}

	if raw == "{}" || raw == "" {
		s.data = nil
		return nil
	}

	raw = strings.TrimPrefix(raw, "{")
	raw = strings.TrimSuffix(raw, "}")

	var elems []string
	var current strings.Builder
	inQuote := false
	escaped := false

	for _, c := range raw {
		switch {
		case escaped:
			current.WriteRune(c)
			escaped = false
		case c == '\\':
			escaped = true
		case c == '"':
			inQuote = !inQuote
		case c == ',' && !inQuote:
			elems = append(elems, current.String())
			current.Reset()
		default:
			current.WriteRune(c)
		}
	}
	if current.Len() > 0 {
		elems = append(elems, current.String())
	}

	s.data = elems
	return nil
}

// Value returns the scanned string slice. If nil, returns an empty slice.
func (s *pqStringArrayScanner) Value() []string {
	if s.data == nil {
		return []string{}
	}
	return s.data
}
