package crawler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
)

// --- Mock implementations ---

type mockInstallationLister struct {
	installations []TenantInstallation
	err           error
}

func (m *mockInstallationLister) ListActiveInstallations(_ context.Context) ([]TenantInstallation, error) {
	return m.installations, m.err
}

type mockDiscoveryRunner struct {
	// repos keyed by tenantID string for per-tenant responses
	reposByTenant map[string][]domain.Repository
	errByTenant   map[string]error
}

func (m *mockDiscoveryRunner) DiscoverForTenant(_ context.Context, tenantID uuid.UUID, _ int64) ([]domain.Repository, error) {
	key := tenantID.String()
	if err, ok := m.errByTenant[key]; ok {
		return nil, err
	}
	return m.reposByTenant[key], nil
}

type velocityCall struct {
	count int
}

type mockVelocityRunner struct {
	// metrics keyed by repoID string
	metricsByRepo map[string]*domain.VelocityMetric
	errByRepo     map[string]error
	// track call counts for retry testing
	callCounts map[string]*velocityCall
	// failUntil: repo -> number of failures before success
	failUntil map[string]int
}

func (m *mockVelocityRunner) AnalyzeRepository(_ context.Context, repo domain.Repository) (*domain.VelocityMetric, error) {
	key := repo.ID.String()

	if m.callCounts == nil {
		m.callCounts = make(map[string]*velocityCall)
	}
	if m.callCounts[key] == nil {
		m.callCounts[key] = &velocityCall{}
	}
	m.callCounts[key].count++

	if m.failUntil != nil {
		if threshold, ok := m.failUntil[key]; ok && m.callCounts[key].count <= threshold {
			return nil, errors.New("transient error")
		}
	}

	if err, ok := m.errByRepo[key]; ok {
		return nil, err
	}
	return m.metricsByRepo[key], nil
}

type publishedEvent struct {
	topic string
	event any
}

type mockPublisher struct {
	events []publishedEvent
	err    error
}

func (m *mockPublisher) Publish(_ context.Context, topic string, event any) error {
	if m.err != nil {
		return m.err
	}
	m.events = append(m.events, publishedEvent{topic: topic, event: event})
	return nil
}

// --- Helpers ---

func makeRepo(tenantID uuid.UUID, name string) domain.Repository {
	orgName := "org"
	return domain.Repository{
		ID:       uuid.New(),
		TenantID: tenantID,
		FullName: name,
		OrgName:  &orgName,
		RepoName: name,
	}
}

func makeMetric(repo domain.Repository, score float64) *domain.VelocityMetric {
	return &domain.VelocityMetric{
		ID:            uuid.New(),
		TenantID:      repo.TenantID,
		RepositoryID:  repo.ID,
		VelocityScore: &score,
		AnalyzedAt:    time.Now(),
	}
}

// --- Tests ---

func TestRun(t *testing.T) {
	t.Run("successful full crawl with 2 tenants", func(t *testing.T) {
		tenant1 := uuid.New()
		tenant2 := uuid.New()

		repos1 := []domain.Repository{makeRepo(tenant1, "repo-a"), makeRepo(tenant1, "repo-b"), makeRepo(tenant1, "repo-c")}
		repos2 := []domain.Repository{makeRepo(tenant2, "repo-d"), makeRepo(tenant2, "repo-e"), makeRepo(tenant2, "repo-f")}

		metrics := make(map[string]*domain.VelocityMetric)
		for _, r := range append(repos1, repos2...) {
			metrics[r.ID.String()] = makeMetric(r, 85.0)
		}

		svc := NewService(
			&mockInstallationLister{installations: []TenantInstallation{
				{TenantID: tenant1, InstallationID: 100},
				{TenantID: tenant2, InstallationID: 200},
			}},
			&mockDiscoveryRunner{
				reposByTenant: map[string][]domain.Repository{
					tenant1.String(): repos1,
					tenant2.String(): repos2,
				},
			},
			&mockVelocityRunner{metricsByRepo: metrics},
			&mockPublisher{},
			DefaultConfig(),
		)

		result, err := svc.Run(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TenantsProcessed != 2 {
			t.Errorf("TenantsProcessed = %d, want 2", result.TenantsProcessed)
		}
		if result.ReposDiscovered != 6 {
			t.Errorf("ReposDiscovered = %d, want 6", result.ReposDiscovered)
		}
		if result.MetricsExtracted != 6 {
			t.Errorf("MetricsExtracted = %d, want 6", result.MetricsExtracted)
		}
		if len(result.Errors) != 0 {
			t.Errorf("got %d errors, want 0", len(result.Errors))
		}
		if result.Duration <= 0 {
			t.Error("Duration should be positive")
		}
	})

	t.Run("partial failure continues processing", func(t *testing.T) {
		tenant1 := uuid.New()
		tenant2 := uuid.New()

		repos1 := []domain.Repository{makeRepo(tenant1, "repo-ok"), makeRepo(tenant1, "repo-fail")}
		repos2 := []domain.Repository{makeRepo(tenant2, "repo-ok2")}

		metrics := map[string]*domain.VelocityMetric{
			repos1[0].ID.String(): makeMetric(repos1[0], 90.0),
			repos2[0].ID.String(): makeMetric(repos2[0], 75.0),
		}
		errMap := map[string]error{
			repos1[1].ID.String(): errors.New("api rate limited"),
		}

		svc := NewService(
			&mockInstallationLister{installations: []TenantInstallation{
				{TenantID: tenant1, InstallationID: 100},
				{TenantID: tenant2, InstallationID: 200},
			}},
			&mockDiscoveryRunner{
				reposByTenant: map[string][]domain.Repository{
					tenant1.String(): repos1,
					tenant2.String(): repos2,
				},
			},
			&mockVelocityRunner{metricsByRepo: metrics, errByRepo: errMap},
			&mockPublisher{},
			Config{MaxReposPerRun: 100, MaxRetries: 1, EventTopic: "test-topic"},
		)

		result, err := svc.Run(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TenantsProcessed != 2 {
			t.Errorf("TenantsProcessed = %d, want 2", result.TenantsProcessed)
		}
		if result.MetricsExtracted != 2 {
			t.Errorf("MetricsExtracted = %d, want 2", result.MetricsExtracted)
		}
		if len(result.Errors) != 1 {
			t.Fatalf("got %d errors, want 1", len(result.Errors))
		}
		if result.Errors[0].Phase != "velocity" {
			t.Errorf("error phase = %q, want %q", result.Errors[0].Phase, "velocity")
		}
	})

	t.Run("context cancellation mid-crawl", func(t *testing.T) {
		tenant1 := uuid.New()
		repos := []domain.Repository{makeRepo(tenant1, "repo1")}

		ctx, cancel := context.WithCancel(context.Background())

		// Cancel before the velocity analysis runs.
		discovery := &mockDiscoveryRunner{
			reposByTenant: map[string][]domain.Repository{
				tenant1.String(): repos,
			},
		}

		// Velocity runner that cancels on first call
		cancellingVelocity := &cancellingVelocityRunner{
			cancel: cancel,
		}

		svc := NewService(
			&mockInstallationLister{installations: []TenantInstallation{
				{TenantID: tenant1, InstallationID: 100},
			}},
			discovery,
			cancellingVelocity,
			&mockPublisher{},
			Config{MaxReposPerRun: 100, MaxRetries: 3, EventTopic: "test"},
		)

		result, err := svc.Run(ctx)
		if !errors.Is(err, context.Canceled) {
			t.Errorf("expected context.Canceled, got: %v", err)
		}
		if result == nil {
			t.Fatal("result should not be nil on cancellation")
		}
	})

	t.Run("MaxReposPerRun limit enforcement", func(t *testing.T) {
		tenant1 := uuid.New()
		tenant2 := uuid.New()

		repos1 := []domain.Repository{makeRepo(tenant1, "r1"), makeRepo(tenant1, "r2"), makeRepo(tenant1, "r3")}
		repos2 := []domain.Repository{makeRepo(tenant2, "r4"), makeRepo(tenant2, "r5")}

		metrics := make(map[string]*domain.VelocityMetric)
		for _, r := range append(repos1, repos2...) {
			metrics[r.ID.String()] = makeMetric(r, 50.0)
		}

		svc := NewService(
			&mockInstallationLister{installations: []TenantInstallation{
				{TenantID: tenant1, InstallationID: 100},
				{TenantID: tenant2, InstallationID: 200},
			}},
			&mockDiscoveryRunner{
				reposByTenant: map[string][]domain.Repository{
					tenant1.String(): repos1,
					tenant2.String(): repos2,
				},
			},
			&mockVelocityRunner{metricsByRepo: metrics},
			&mockPublisher{},
			Config{MaxReposPerRun: 4, MaxRetries: 1, EventTopic: "test"},
		)

		result, err := svc.Run(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// Tenant1 has 3 repos, tenant2 should be limited to 1 (4 - 3 = 1).
		if result.ReposDiscovered != 4 {
			t.Errorf("ReposDiscovered = %d, want 4", result.ReposDiscovered)
		}
		if result.MetricsExtracted != 4 {
			t.Errorf("MetricsExtracted = %d, want 4", result.MetricsExtracted)
		}
	})

	t.Run("retry logic succeeds on third attempt", func(t *testing.T) {
		tenant := uuid.New()
		repo := makeRepo(tenant, "flaky-repo")
		metric := makeMetric(repo, 70.0)

		velocity := &mockVelocityRunner{
			metricsByRepo: map[string]*domain.VelocityMetric{
				repo.ID.String(): metric,
			},
			failUntil: map[string]int{
				repo.ID.String(): 2, // fail first 2 attempts, succeed on 3rd
			},
		}

		svc := NewService(
			&mockInstallationLister{installations: []TenantInstallation{
				{TenantID: tenant, InstallationID: 100},
			}},
			&mockDiscoveryRunner{
				reposByTenant: map[string][]domain.Repository{
					tenant.String(): {repo},
				},
			},
			velocity,
			&mockPublisher{},
			Config{MaxReposPerRun: 100, MaxRetries: 3, EventTopic: "test"},
		)

		result, err := svc.Run(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.MetricsExtracted != 1 {
			t.Errorf("MetricsExtracted = %d, want 1", result.MetricsExtracted)
		}
		if len(result.Errors) != 0 {
			t.Errorf("got %d errors, want 0", len(result.Errors))
		}
		if velocity.callCounts[repo.ID.String()].count != 3 {
			t.Errorf("velocity called %d times, want 3", velocity.callCounts[repo.ID.String()].count)
		}
	})

	t.Run("empty installations list", func(t *testing.T) {
		svc := NewService(
			&mockInstallationLister{installations: nil},
			&mockDiscoveryRunner{},
			&mockVelocityRunner{},
			&mockPublisher{},
			DefaultConfig(),
		)

		result, err := svc.Run(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TenantsProcessed != 0 {
			t.Errorf("TenantsProcessed = %d, want 0", result.TenantsProcessed)
		}
		if result.ReposDiscovered != 0 {
			t.Errorf("ReposDiscovered = %d, want 0", result.ReposDiscovered)
		}
		if result.MetricsExtracted != 0 {
			t.Errorf("MetricsExtracted = %d, want 0", result.MetricsExtracted)
		}
	})

	t.Run("discovery error for one tenant does not block others", func(t *testing.T) {
		tenant1 := uuid.New()
		tenant2 := uuid.New()

		repos2 := []domain.Repository{makeRepo(tenant2, "good-repo")}
		metrics := map[string]*domain.VelocityMetric{
			repos2[0].ID.String(): makeMetric(repos2[0], 60.0),
		}

		svc := NewService(
			&mockInstallationLister{installations: []TenantInstallation{
				{TenantID: tenant1, InstallationID: 100},
				{TenantID: tenant2, InstallationID: 200},
			}},
			&mockDiscoveryRunner{
				reposByTenant: map[string][]domain.Repository{
					tenant2.String(): repos2,
				},
				errByTenant: map[string]error{
					tenant1.String(): errors.New("GitHub API unavailable"),
				},
			},
			&mockVelocityRunner{metricsByRepo: metrics},
			&mockPublisher{},
			Config{MaxReposPerRun: 100, MaxRetries: 1, EventTopic: "test"},
		)

		result, err := svc.Run(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TenantsProcessed != 1 {
			t.Errorf("TenantsProcessed = %d, want 1", result.TenantsProcessed)
		}
		if result.MetricsExtracted != 1 {
			t.Errorf("MetricsExtracted = %d, want 1", result.MetricsExtracted)
		}
		if len(result.Errors) != 1 {
			t.Fatalf("got %d errors, want 1", len(result.Errors))
		}
		if result.Errors[0].Phase != "discovery" {
			t.Errorf("error phase = %q, want %q", result.Errors[0].Phase, "discovery")
		}
	})

	t.Run("installation lister error returns error", func(t *testing.T) {
		svc := NewService(
			&mockInstallationLister{err: errors.New("database connection failed")},
			&mockDiscoveryRunner{},
			&mockVelocityRunner{},
			&mockPublisher{},
			DefaultConfig(),
		)

		_, err := svc.Run(context.Background())
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

// cancellingVelocityRunner cancels the context on first call and returns context.Canceled.
type cancellingVelocityRunner struct {
	cancel context.CancelFunc
}

func (c *cancellingVelocityRunner) AnalyzeRepository(_ context.Context, _ domain.Repository) (*domain.VelocityMetric, error) {
	c.cancel()
	return nil, context.Canceled
}
