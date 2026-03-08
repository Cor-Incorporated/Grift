package github

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/Cor-Incorporated/BenevolentDirector/services/control-api/internal/domain"
	"github.com/google/uuid"
)

// VelocityStore persists velocity metrics.
type VelocityStore interface {
	// Insert appends a new velocity metric record (append-only, no updates).
	Insert(ctx context.Context, metric *domain.VelocityMetric) error
	// LatestByRepositoryAndTenant returns the most recent velocity metric
	// for a repository scoped to the given tenant.
	LatestByRepositoryAndTenant(ctx context.Context, repoID, tenantID uuid.UUID) (*domain.VelocityMetric, error)
	// ListByRepository returns the most recent velocity metrics for a repository,
	// ordered by analyzed_at descending, limited to the given count.
	ListByRepository(ctx context.Context, repoID uuid.UUID, limit int) ([]domain.VelocityMetric, error)
}

// SQLVelocityStore implements VelocityStore using a *sql.DB connection pool.
type SQLVelocityStore struct {
	DB *sql.DB
}

// NewSQLVelocityStore creates a new SQLVelocityStore.
func NewSQLVelocityStore(db *sql.DB) *SQLVelocityStore {
	return &SQLVelocityStore{DB: db}
}

// Insert appends a new velocity metric record to the velocity_metrics table.
func (s *SQLVelocityStore) Insert(ctx context.Context, metric *domain.VelocityMetric) error {
	if metric == nil {
		return fmt.Errorf("metric must not be nil")
	}

	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO velocity_metrics (
			id, tenant_id, repository_id,
			commits_per_week, active_days_per_week, pr_merge_frequency,
			issue_close_speed, churn_rate, contributor_count,
			velocity_score, estimated_hours,
			analyzed_at, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		metric.ID,
		metric.TenantID,
		metric.RepositoryID,
		metric.CommitsPerWeek,
		metric.ActiveDaysPerWeek,
		metric.PRMergeFrequency,
		metric.IssueCloseSpeed,
		metric.ChurnRate,
		metric.ContributorCount,
		metric.VelocityScore,
		metric.EstimatedHours,
		metric.AnalyzedAt,
		metric.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("inserting velocity metric: %w", err)
	}
	return nil
}

// LatestByRepositoryAndTenant returns the most recent velocity metric for the
// given repository scoped to the given tenant. Returns sql.ErrNoRows wrapped
// in an error if no metric exists.
func (s *SQLVelocityStore) LatestByRepositoryAndTenant(ctx context.Context, repoID, tenantID uuid.UUID) (*domain.VelocityMetric, error) {
	var m domain.VelocityMetric
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, tenant_id, repository_id,
			commits_per_week, active_days_per_week, pr_merge_frequency,
			issue_close_speed, churn_rate, contributor_count,
			velocity_score, estimated_hours,
			analyzed_at, created_at
		FROM velocity_metrics
		WHERE repository_id = $1 AND tenant_id = $2
		ORDER BY analyzed_at DESC
		LIMIT 1`,
		repoID, tenantID,
	).Scan(
		&m.ID, &m.TenantID, &m.RepositoryID,
		&m.CommitsPerWeek, &m.ActiveDaysPerWeek, &m.PRMergeFrequency,
		&m.IssueCloseSpeed, &m.ChurnRate, &m.ContributorCount,
		&m.VelocityScore, &m.EstimatedHours,
		&m.AnalyzedAt, &m.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("querying latest velocity metric: %w", err)
	}
	return &m, nil
}

// ListByRepository returns the most recent velocity metrics for the given repository,
// ordered by analyzed_at descending.
func (s *SQLVelocityStore) ListByRepository(ctx context.Context, repoID uuid.UUID, limit int) ([]domain.VelocityMetric, error) {
	if limit <= 0 {
		limit = 10
	}

	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, tenant_id, repository_id,
			commits_per_week, active_days_per_week, pr_merge_frequency,
			issue_close_speed, churn_rate, contributor_count,
			velocity_score, estimated_hours,
			analyzed_at, created_at
		FROM velocity_metrics
		WHERE repository_id = $1
		ORDER BY analyzed_at DESC
		LIMIT $2`,
		repoID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("querying velocity metrics: %w", err)
	}
	defer rows.Close()

	metrics := make([]domain.VelocityMetric, 0, limit)
	for rows.Next() {
		var m domain.VelocityMetric
		if err := rows.Scan(
			&m.ID, &m.TenantID, &m.RepositoryID,
			&m.CommitsPerWeek, &m.ActiveDaysPerWeek, &m.PRMergeFrequency,
			&m.IssueCloseSpeed, &m.ChurnRate, &m.ContributorCount,
			&m.VelocityScore, &m.EstimatedHours,
			&m.AnalyzedAt, &m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning velocity metric row: %w", err)
		}
		metrics = append(metrics, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating velocity metric rows: %w", err)
	}
	return metrics, nil
}
