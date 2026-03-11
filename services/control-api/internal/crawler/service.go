package crawler

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
)

// DiscoveryRunner discovers repositories for a tenant installation.
type DiscoveryRunner interface {
	DiscoverForTenant(ctx context.Context, tenantID uuid.UUID, installationID int64) ([]domain.Repository, error)
}

// VelocityRunner extracts velocity metrics for a repository.
type VelocityRunner interface {
	AnalyzeRepository(ctx context.Context, repo domain.Repository) (*domain.VelocityMetric, error)
}

// EventPublisher publishes domain events to a message broker.
type EventPublisher interface {
	Publish(ctx context.Context, topic string, event any) error
}

// TenantInstallationLister lists tenant installations for crawling.
type TenantInstallationLister interface {
	ListActiveInstallations(ctx context.Context) ([]TenantInstallation, error)
}

// TenantInstallation represents an active GitHub App installation for a tenant.
type TenantInstallation struct {
	TenantID       uuid.UUID
	InstallationID int64
}

// CrawlResult contains the summary of a crawl run.
type CrawlResult struct {
	TenantsProcessed int           `json:"tenants_processed"`
	ReposDiscovered  int           `json:"repos_discovered"`
	MetricsExtracted int           `json:"metrics_extracted"`
	Errors           []CrawlError  `json:"errors,omitempty"`
	Duration         time.Duration `json:"duration"`
}

// CrawlError captures a non-fatal error encountered during crawling.
type CrawlError struct {
	TenantID     uuid.UUID  `json:"tenant_id"`
	RepositoryID *uuid.UUID `json:"repository_id,omitempty"`
	Phase        string     `json:"phase"`
	Error        string     `json:"error"`
}

// Config holds tunable parameters for the crawl service.
type Config struct {
	MaxReposPerRun int
	MaxRetries     int
	EventTopic     string
}

// DefaultConfig returns sensible defaults for production use.
func DefaultConfig() Config {
	return Config{
		MaxReposPerRun: 100,
		MaxRetries:     3,
		EventTopic:     "velocity-metric-refreshed",
	}
}

// Service orchestrates the periodic repository crawl workflow:
// discover repos -> extract velocity -> publish events.
type Service struct {
	installations TenantInstallationLister
	discovery     DiscoveryRunner
	velocity      VelocityRunner
	publisher     EventPublisher
	config        Config
}

// NewService creates a new crawl Service with the given dependencies.
func NewService(
	installations TenantInstallationLister,
	discovery DiscoveryRunner,
	velocity VelocityRunner,
	publisher EventPublisher,
	config Config,
) *Service {
	return &Service{
		installations: installations,
		discovery:     discovery,
		velocity:      velocity,
		publisher:     publisher,
		config:        config,
	}
}

// Run executes a full crawl cycle: list installations, discover repos,
// analyze velocity, and publish events. It is fail-open per repository,
// collecting errors without aborting the entire run.
func (s *Service) Run(ctx context.Context) (*CrawlResult, error) {
	start := time.Now()
	result := &CrawlResult{}

	installs, err := s.installations.ListActiveInstallations(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing active installations: %w", err)
	}

	totalRepos := 0

	for _, inst := range installs {
		select {
		case <-ctx.Done():
			result.Duration = time.Since(start)
			return result, ctx.Err()
		default:
		}

		repos, err := s.discovery.DiscoverForTenant(ctx, inst.TenantID, inst.InstallationID)
		if err != nil {
			result.Errors = append(result.Errors, CrawlError{
				TenantID: inst.TenantID,
				Phase:    "discovery",
				Error:    err.Error(),
			})
			continue
		}

		result.TenantsProcessed++

		// Enforce per-run repo limit across all tenants.
		remaining := s.config.MaxReposPerRun - totalRepos
		if remaining <= 0 {
			break
		}
		if len(repos) > remaining {
			repos = repos[:remaining]
		}

		result.ReposDiscovered += len(repos)
		totalRepos += len(repos)

		for i := range repos {
			select {
			case <-ctx.Done():
				result.Duration = time.Since(start)
				return result, ctx.Err()
			default:
			}

			metric, err := s.analyzeWithRetry(ctx, repos[i])
			if err != nil {
				// If context was cancelled, return immediately.
				if ctx.Err() != nil {
					result.Duration = time.Since(start)
					return result, ctx.Err()
				}
				repoID := repos[i].ID
				result.Errors = append(result.Errors, CrawlError{
					TenantID:     inst.TenantID,
					RepositoryID: &repoID,
					Phase:        "velocity",
					Error:        err.Error(),
				})
				continue
			}

			score := 0.0
			if metric.VelocityScore != nil {
				score = *metric.VelocityScore
			}

			event := VelocityMetricRefreshedEvent{
				TenantID:      inst.TenantID.String(),
				RepositoryID:  repos[i].ID.String(),
				RepoFullName:  repos[i].FullName,
				VelocityScore: score,
				AnalyzedAt:    metric.AnalyzedAt,
				Version:       "1",
			}

			if pubErr := s.publisher.Publish(ctx, s.config.EventTopic, event); pubErr != nil {
				repoID := repos[i].ID
				result.Errors = append(result.Errors, CrawlError{
					TenantID:     inst.TenantID,
					RepositoryID: &repoID,
					Phase:        "publish",
					Error:        pubErr.Error(),
				})
				continue
			}

			result.MetricsExtracted++
		}
	}

	result.Duration = time.Since(start)
	return result, nil
}

// analyzeWithRetry attempts velocity analysis up to MaxRetries times.
func (s *Service) analyzeWithRetry(ctx context.Context, repo domain.Repository) (*domain.VelocityMetric, error) {
	var lastErr error
	for attempt := range s.config.MaxRetries {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		metric, err := s.velocity.AnalyzeRepository(ctx, repo)
		if err == nil {
			return metric, nil
		}

		// Propagate context errors immediately without retry.
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		lastErr = err

		// No backoff on last attempt since we won't retry.
		if attempt < s.config.MaxRetries-1 {
			// Simple exponential-ish backoff: 1s, 2s, 4s, ...
			backoff := time.Duration(1<<uint(attempt)) * time.Second
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}
	}
	return nil, fmt.Errorf("velocity analysis failed after %d attempts: %w", s.config.MaxRetries, lastErr)
}
