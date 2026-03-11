package crawler_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/crawler"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	gh "github.com/Cor-Incorporated/Grift/services/control-api/internal/github"
)

// --- Adapters: bridge github.* to crawler interfaces ---

// discoveryAdapter adapts github.DiscoveryService to crawler.DiscoveryRunner.
type discoveryAdapter struct {
	svc *gh.DiscoveryService
}

func (a *discoveryAdapter) DiscoverForTenant(ctx context.Context, tenantID uuid.UUID, _ int64) ([]domain.Repository, error) {
	ghRepos, err := a.svc.ListAccessibleRepos(ctx)
	if err != nil {
		return nil, err
	}

	repos := make([]domain.Repository, 0, len(ghRepos))
	for _, gr := range ghRepos {
		orgName := gr.Owner.Login
		repos = append(repos, domain.Repository{
			ID:          uuid.New(),
			TenantID:    tenantID,
			GitHubID:    &gr.ID,
			OrgName:     &orgName,
			RepoName:    gr.Name,
			FullName:    gr.FullName,
			Description: gr.Description,
			Language:    gr.Language,
			Stars:       gr.StarCount,
			Topics:      gr.Topics,
			IsPrivate:   gr.Private,
			IsArchived:  gr.Archived,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		})
	}
	return repos, nil
}

// velocityAdapter adapts github.VelocityAnalyzer to crawler.VelocityRunner.
type velocityAdapter struct {
	analyzer *gh.VelocityAnalyzer
}

func (a *velocityAdapter) AnalyzeRepository(ctx context.Context, repo domain.Repository) (*domain.VelocityMetric, error) {
	owner := ""
	if repo.OrgName != nil {
		owner = *repo.OrgName
	}

	raw, err := a.analyzer.Analyze(ctx, owner, repo.RepoName)
	if err != nil {
		return nil, err
	}

	normalized := a.analyzer.Normalize(raw)

	return &domain.VelocityMetric{
		ID:                uuid.New(),
		TenantID:          repo.TenantID,
		RepositoryID:      repo.ID,
		CommitsPerWeek:    &normalized.CommitsPerWeek,
		ActiveDaysPerWeek: &normalized.ActiveDaysPerWeek,
		PRMergeFrequency:  &normalized.PRMergeFrequency,
		IssueCloseSpeed:   &normalized.IssueCloseSpeed,
		ChurnRate:         &normalized.ChurnRate,
		ContributorCount:  &normalized.ContributorCount,
		VelocityScore:     &normalized.VelocityScore,
		AnalyzedAt:        time.Now(),
		CreatedAt:         time.Now(),
	}, nil
}

// --- Fakes ---

type fakeInstallationLister struct {
	installations []crawler.TenantInstallation
}

func (f *fakeInstallationLister) ListActiveInstallations(_ context.Context) ([]crawler.TenantInstallation, error) {
	return f.installations, nil
}

type publishedEvent struct {
	topic string
	event any
}

type fakePublisher struct {
	events []publishedEvent
	err    error
}

func (f *fakePublisher) Publish(_ context.Context, topic string, event any) error {
	if f.err != nil {
		return f.err
	}
	f.events = append(f.events, publishedEvent{topic: topic, event: event})
	return nil
}

// --- Mock GitHub API server ---

type mockGitHubServerConfig struct {
	repos []mockRepo
}

type mockRepo struct {
	id          int64
	owner       string
	name        string
	fullName    string
	language    string
	stars       int
	description string
}

func newMockGitHubServer(t *testing.T, cfg mockGitHubServerConfig) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()

	// Installation token endpoint
	mux.HandleFunc("POST /app/installations/{installationId}/access_tokens", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"token":"test-token","expires_at":"%s"}`,
			time.Now().Add(time.Hour).Format(time.RFC3339))
	})

	// Installation repositories endpoint
	mux.HandleFunc("GET /installation/repositories", func(w http.ResponseWriter, _ *http.Request) {
		repos := make([]map[string]any, 0, len(cfg.repos))
		for _, r := range cfg.repos {
			repos = append(repos, map[string]any{
				"id":               r.id,
				"full_name":        r.fullName,
				"name":             r.name,
				"owner":            map[string]any{"login": r.owner},
				"description":      r.description,
				"language":         r.language,
				"stargazers_count": r.stars,
				"topics":           []string{},
				"private":          false,
				"archived":         false,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"total_count":  len(repos),
			"repositories": repos,
		})
	})

	// Per-repo velocity endpoints
	for _, repo := range cfg.repos {
		owner := repo.owner
		name := repo.name

		// Commit activity
		pattern := fmt.Sprintf("GET /repos/%s/%s/stats/commit_activity", owner, name)
		mux.HandleFunc(pattern, func(w http.ResponseWriter, _ *http.Request) {
			weeks := make([]map[string]any, 52)
			for i := range 52 {
				total := 5 // default commits per week
				if i >= 39 {
					total = 10 // last 13 weeks: higher activity
				}
				weeks[i] = map[string]any{
					"total": total,
					"week":  time.Now().AddDate(0, 0, -(52-i)*7).Unix(),
					"days":  []int{1, 2, 1, 0, 1, 0, 0},
				}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(weeks)
		})

		// Merged PRs (pulls?state=closed)
		pattern = fmt.Sprintf("GET /repos/%s/%s/pulls", owner, name)
		mux.HandleFunc(pattern, func(w http.ResponseWriter, _ *http.Request) {
			prs := []map[string]any{
				{"id": 1, "number": 1, "merged_at": time.Now().AddDate(0, 0, -10).Format(time.RFC3339), "state": "closed"},
				{"id": 2, "number": 2, "merged_at": time.Now().AddDate(0, 0, -20).Format(time.RFC3339), "state": "closed"},
				{"id": 3, "number": 3, "merged_at": time.Now().AddDate(0, 0, -30).Format(time.RFC3339), "state": "closed"},
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(prs)
		})

		// Issues (closed)
		pattern = fmt.Sprintf("GET /repos/%s/%s/issues", owner, name)
		mux.HandleFunc(pattern, func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			issues := []map[string]any{
				{
					"id":         1,
					"number":     1,
					"state":      "closed",
					"created_at": time.Now().AddDate(0, 0, -15).Format(time.RFC3339),
					"closed_at":  time.Now().AddDate(0, 0, -12).Format(time.RFC3339),
				},
			}
			_ = json.NewEncoder(w).Encode(issues)
		})

		// Contributors
		pattern = fmt.Sprintf("GET /repos/%s/%s/stats/contributors", owner, name)
		mux.HandleFunc(pattern, func(w http.ResponseWriter, _ *http.Request) {
			contributors := []map[string]any{
				{"author": map[string]any{"login": "dev1"}, "total": 100, "weeks": []map[string]any{{"a": 500, "d": 200, "c": 20}}},
				{"author": map[string]any{"login": "dev2"}, "total": 50, "weeks": []map[string]any{{"a": 300, "d": 100, "c": 10}}},
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(contributors)
		})

		// Languages
		pattern = fmt.Sprintf("GET /repos/%s/%s/languages", owner, name)
		mux.HandleFunc(pattern, func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]int64{"Go": 50000, "TypeScript": 30000})
		})
	}

	return httptest.NewServer(mux)
}

// staticTokenProvider provides a static token for testing.
type staticTokenProvider struct {
	token string
}

func (s *staticTokenProvider) InstallationToken(_ context.Context) (string, error) {
	return s.token, nil
}

// --- Integration Tests ---

func TestIntegration_FullCrawlFlow(t *testing.T) {
	repos := []mockRepo{
		{id: 1001, owner: "acme", name: "backend", fullName: "acme/backend", language: "Go", stars: 42, description: "Backend service"},
		{id: 1002, owner: "acme", name: "frontend", fullName: "acme/frontend", language: "TypeScript", stars: 18, description: "Frontend app"},
	}

	server := newMockGitHubServer(t, mockGitHubServerConfig{repos: repos})
	defer server.Close()

	tenantID := uuid.New()
	publisher := &fakePublisher{}

	// Wire real github.* components against httptest server
	tokenProvider := &staticTokenProvider{token: "test-token"}
	client := gh.NewClient(tokenProvider)
	discoverySvc := gh.NewDiscoveryService(client, gh.WithDiscoveryBaseURL(server.URL))
	velocityAnalyzer := gh.NewVelocityAnalyzer(client, gh.WithAnalyzerBaseURL(server.URL))

	svc := crawler.NewService(
		&fakeInstallationLister{installations: []crawler.TenantInstallation{
			{TenantID: tenantID, InstallationID: 12345},
		}},
		&discoveryAdapter{svc: discoverySvc},
		&velocityAdapter{analyzer: velocityAnalyzer},
		publisher,
		crawler.Config{MaxReposPerRun: 100, MaxRetries: 1, EventTopic: "velocity-metric-refreshed"},
	)

	result, err := svc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify crawl result
	if result.TenantsProcessed != 1 {
		t.Errorf("TenantsProcessed = %d, want 1", result.TenantsProcessed)
	}
	if result.ReposDiscovered != 2 {
		t.Errorf("ReposDiscovered = %d, want 2", result.ReposDiscovered)
	}
	if result.MetricsExtracted != 2 {
		t.Errorf("MetricsExtracted = %d, want 2", result.MetricsExtracted)
	}
	if len(result.Errors) != 0 {
		t.Errorf("got %d errors, want 0: %+v", len(result.Errors), result.Errors)
	}

	// Verify events published
	if len(publisher.events) != 2 {
		t.Fatalf("published %d events, want 2", len(publisher.events))
	}

	for i, e := range publisher.events {
		if e.topic != "velocity-metric-refreshed" {
			t.Errorf("event[%d] topic = %q, want %q", i, e.topic, "velocity-metric-refreshed")
		}

		evt, ok := e.event.(crawler.VelocityMetricRefreshedEvent)
		if !ok {
			t.Fatalf("event[%d] is not VelocityMetricRefreshedEvent, got %T", i, e.event)
		}

		if evt.TenantID != tenantID.String() {
			t.Errorf("event[%d].TenantID = %q, want %q", i, evt.TenantID, tenantID.String())
		}
		if evt.VelocityScore <= 0 || evt.VelocityScore > 100 {
			t.Errorf("event[%d].VelocityScore = %f, want (0, 100]", i, evt.VelocityScore)
		}
		if evt.Version != "1" {
			t.Errorf("event[%d].Version = %q, want %q", i, evt.Version, "1")
		}
		if evt.AnalyzedAt.IsZero() {
			t.Errorf("event[%d].AnalyzedAt is zero", i)
		}
	}

	// Verify both repos got events
	repoNames := map[string]bool{}
	for _, e := range publisher.events {
		evt := e.event.(crawler.VelocityMetricRefreshedEvent)
		repoNames[evt.RepoFullName] = true
	}
	for _, r := range repos {
		if !repoNames[r.fullName] {
			t.Errorf("missing event for repo %q", r.fullName)
		}
	}
}

func TestIntegration_PartialVelocityFailure(t *testing.T) {
	// One repo has working velocity endpoints, the other returns 500
	goodRepo := mockRepo{id: 2001, owner: "corp", name: "good-svc", fullName: "corp/good-svc", language: "Go"}

	server := newMockGitHubServer(t, mockGitHubServerConfig{repos: []mockRepo{goodRepo}})

	// Add a bad repo to discovery but don't register its velocity endpoints
	mux := http.NewServeMux()
	mux.Handle("/", server.Config.Handler)

	// Override: discovery returns 2 repos (good + bad)
	discoveryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/installation/repositories" {
			repos := []map[string]any{
				{"id": 2001, "full_name": "corp/good-svc", "name": "good-svc", "owner": map[string]any{"login": "corp"}, "stargazers_count": 0, "topics": []string{}, "private": false, "archived": false},
				{"id": 2002, "full_name": "corp/broken-svc", "name": "broken-svc", "owner": map[string]any{"login": "corp"}, "stargazers_count": 0, "topics": []string{}, "private": false, "archived": false},
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"total_count": 2, "repositories": repos})
			return
		}

		// broken-svc velocity endpoints return 500
		if strings.Contains(r.URL.Path, "/repos/corp/broken-svc/") {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Delegate everything else to the main server
		server.Config.Handler.ServeHTTP(w, r)
	}))
	defer discoveryServer.Close()
	defer server.Close()

	tenantID := uuid.New()
	publisher := &fakePublisher{}

	tokenProvider := &staticTokenProvider{token: "test-token"}
	client := gh.NewClient(tokenProvider)
	discoverySvc := gh.NewDiscoveryService(client, gh.WithDiscoveryBaseURL(discoveryServer.URL))
	velocityAnalyzer := gh.NewVelocityAnalyzer(client, gh.WithAnalyzerBaseURL(discoveryServer.URL))

	svc := crawler.NewService(
		&fakeInstallationLister{installations: []crawler.TenantInstallation{
			{TenantID: tenantID, InstallationID: 12345},
		}},
		&discoveryAdapter{svc: discoverySvc},
		&velocityAdapter{analyzer: velocityAnalyzer},
		publisher,
		crawler.Config{MaxReposPerRun: 100, MaxRetries: 1, EventTopic: "velocity-metric-refreshed"},
	)

	result, err := svc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// good-svc succeeds, broken-svc fails
	if result.ReposDiscovered != 2 {
		t.Errorf("ReposDiscovered = %d, want 2", result.ReposDiscovered)
	}
	if result.MetricsExtracted != 1 {
		t.Errorf("MetricsExtracted = %d, want 1", result.MetricsExtracted)
	}
	if len(result.Errors) != 1 {
		t.Fatalf("got %d errors, want 1", len(result.Errors))
	}
	if result.Errors[0].Phase != "velocity" {
		t.Errorf("error phase = %q, want %q", result.Errors[0].Phase, "velocity")
	}

	// Only good-svc should have event
	if len(publisher.events) != 1 {
		t.Fatalf("published %d events, want 1", len(publisher.events))
	}
	evt := publisher.events[0].event.(crawler.VelocityMetricRefreshedEvent)
	if evt.RepoFullName != "corp/good-svc" {
		t.Errorf("event repo = %q, want %q", evt.RepoFullName, "corp/good-svc")
	}
}

func TestIntegration_EventPublisherFailure(t *testing.T) {
	repos := []mockRepo{
		{id: 3001, owner: "org1", name: "svc1", fullName: "org1/svc1", language: "Go"},
	}

	server := newMockGitHubServer(t, mockGitHubServerConfig{repos: repos})
	defer server.Close()

	tenantID := uuid.New()
	publisher := &fakePublisher{err: fmt.Errorf("pub/sub connection refused")}

	tokenProvider := &staticTokenProvider{token: "test-token"}
	client := gh.NewClient(tokenProvider)
	discoverySvc := gh.NewDiscoveryService(client, gh.WithDiscoveryBaseURL(server.URL))
	velocityAnalyzer := gh.NewVelocityAnalyzer(client, gh.WithAnalyzerBaseURL(server.URL))

	svc := crawler.NewService(
		&fakeInstallationLister{installations: []crawler.TenantInstallation{
			{TenantID: tenantID, InstallationID: 12345},
		}},
		&discoveryAdapter{svc: discoverySvc},
		&velocityAdapter{analyzer: velocityAnalyzer},
		publisher,
		crawler.Config{MaxReposPerRun: 100, MaxRetries: 1, EventTopic: "velocity-metric-refreshed"},
	)

	result, err := svc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Discovery and velocity succeed, but publishing fails
	if result.ReposDiscovered != 1 {
		t.Errorf("ReposDiscovered = %d, want 1", result.ReposDiscovered)
	}
	// MetricsExtracted is 0 because publish error causes continue (no increment)
	if result.MetricsExtracted != 0 {
		t.Errorf("MetricsExtracted = %d, want 0 (publish failed)", result.MetricsExtracted)
	}
	if len(result.Errors) != 1 {
		t.Fatalf("got %d errors, want 1", len(result.Errors))
	}
	if result.Errors[0].Phase != "publish" {
		t.Errorf("error phase = %q, want %q", result.Errors[0].Phase, "publish")
	}
}

func TestIntegration_IdempotentCrawl(t *testing.T) {
	repos := []mockRepo{
		{id: 4001, owner: "stable", name: "api", fullName: "stable/api", language: "Go", stars: 100},
	}

	server := newMockGitHubServer(t, mockGitHubServerConfig{repos: repos})
	defer server.Close()

	tenantID := uuid.New()
	publisher := &fakePublisher{}

	tokenProvider := &staticTokenProvider{token: "test-token"}
	client := gh.NewClient(tokenProvider)
	discoverySvc := gh.NewDiscoveryService(client, gh.WithDiscoveryBaseURL(server.URL))
	velocityAnalyzer := gh.NewVelocityAnalyzer(client, gh.WithAnalyzerBaseURL(server.URL))

	svc := crawler.NewService(
		&fakeInstallationLister{installations: []crawler.TenantInstallation{
			{TenantID: tenantID, InstallationID: 12345},
		}},
		&discoveryAdapter{svc: discoverySvc},
		&velocityAdapter{analyzer: velocityAnalyzer},
		publisher,
		crawler.Config{MaxReposPerRun: 100, MaxRetries: 1, EventTopic: "velocity-metric-refreshed"},
	)

	// Run crawl twice
	result1, err := svc.Run(context.Background())
	if err != nil {
		t.Fatalf("first run error: %v", err)
	}
	result2, err := svc.Run(context.Background())
	if err != nil {
		t.Fatalf("second run error: %v", err)
	}

	// Both runs should produce identical results
	if result1.ReposDiscovered != result2.ReposDiscovered {
		t.Errorf("ReposDiscovered mismatch: run1=%d, run2=%d", result1.ReposDiscovered, result2.ReposDiscovered)
	}
	if result1.MetricsExtracted != result2.MetricsExtracted {
		t.Errorf("MetricsExtracted mismatch: run1=%d, run2=%d", result1.MetricsExtracted, result2.MetricsExtracted)
	}

	// Each run produces 1 event, so total = 2
	if len(publisher.events) != 2 {
		t.Fatalf("published %d events, want 2", len(publisher.events))
	}

	// Both events should reference the same repo full name
	evt1 := publisher.events[0].event.(crawler.VelocityMetricRefreshedEvent)
	evt2 := publisher.events[1].event.(crawler.VelocityMetricRefreshedEvent)
	if evt1.RepoFullName != evt2.RepoFullName {
		t.Errorf("repo mismatch: %q vs %q", evt1.RepoFullName, evt2.RepoFullName)
	}

	// Velocity scores should be consistent (same mock data)
	if evt1.VelocityScore != evt2.VelocityScore {
		t.Errorf("velocity score mismatch: %f vs %f", evt1.VelocityScore, evt2.VelocityScore)
	}
}

func TestIntegration_EmptyInstallation(t *testing.T) {
	// No repos returned by GitHub
	server := newMockGitHubServer(t, mockGitHubServerConfig{repos: nil})
	defer server.Close()

	tenantID := uuid.New()
	publisher := &fakePublisher{}

	tokenProvider := &staticTokenProvider{token: "test-token"}
	client := gh.NewClient(tokenProvider)
	discoverySvc := gh.NewDiscoveryService(client, gh.WithDiscoveryBaseURL(server.URL))
	velocityAnalyzer := gh.NewVelocityAnalyzer(client, gh.WithAnalyzerBaseURL(server.URL))

	svc := crawler.NewService(
		&fakeInstallationLister{installations: []crawler.TenantInstallation{
			{TenantID: tenantID, InstallationID: 12345},
		}},
		&discoveryAdapter{svc: discoverySvc},
		&velocityAdapter{analyzer: velocityAnalyzer},
		publisher,
		crawler.Config{MaxReposPerRun: 100, MaxRetries: 1, EventTopic: "velocity-metric-refreshed"},
	)

	result, err := svc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.TenantsProcessed != 1 {
		t.Errorf("TenantsProcessed = %d, want 1", result.TenantsProcessed)
	}
	if result.ReposDiscovered != 0 {
		t.Errorf("ReposDiscovered = %d, want 0", result.ReposDiscovered)
	}
	if result.MetricsExtracted != 0 {
		t.Errorf("MetricsExtracted = %d, want 0", result.MetricsExtracted)
	}
	if len(publisher.events) != 0 {
		t.Errorf("published %d events, want 0", len(publisher.events))
	}
}

func TestIntegration_ContextCancellation(t *testing.T) {
	repos := []mockRepo{
		{id: 5001, owner: "slow", name: "repo1", fullName: "slow/repo1", language: "Go"},
	}

	server := newMockGitHubServer(t, mockGitHubServerConfig{repos: repos})
	defer server.Close()

	tenantID := uuid.New()
	publisher := &fakePublisher{}

	tokenProvider := &staticTokenProvider{token: "test-token"}
	client := gh.NewClient(tokenProvider)
	discoverySvc := gh.NewDiscoveryService(client, gh.WithDiscoveryBaseURL(server.URL))

	// Velocity adapter that cancels the context
	ctx, cancel := context.WithCancel(context.Background())
	cancellingVelocity := &cancellingVelocityAdapter{cancel: cancel}

	svc := crawler.NewService(
		&fakeInstallationLister{installations: []crawler.TenantInstallation{
			{TenantID: tenantID, InstallationID: 12345},
		}},
		&discoveryAdapter{svc: discoverySvc},
		cancellingVelocity,
		publisher,
		crawler.Config{MaxReposPerRun: 100, MaxRetries: 3, EventTopic: "velocity-metric-refreshed"},
	)

	result, err := svc.Run(ctx)
	if err == nil {
		t.Fatal("expected context.Canceled error, got nil")
	}
	if result == nil {
		t.Fatal("result should not be nil on cancellation")
	}
	if len(publisher.events) != 0 {
		t.Errorf("published %d events on cancellation, want 0", len(publisher.events))
	}
}

type cancellingVelocityAdapter struct {
	cancel context.CancelFunc
}

func (c *cancellingVelocityAdapter) AnalyzeRepository(_ context.Context, _ domain.Repository) (*domain.VelocityMetric, error) {
	c.cancel()
	return nil, context.Canceled
}

func TestIntegration_MultiTenantIsolation(t *testing.T) {
	repos := []mockRepo{
		{id: 6001, owner: "multi", name: "shared", fullName: "multi/shared", language: "Go"},
	}

	server := newMockGitHubServer(t, mockGitHubServerConfig{repos: repos})
	defer server.Close()

	tenant1 := uuid.New()
	tenant2 := uuid.New()
	publisher := &fakePublisher{}

	tokenProvider := &staticTokenProvider{token: "test-token"}
	client := gh.NewClient(tokenProvider)
	discoverySvc := gh.NewDiscoveryService(client, gh.WithDiscoveryBaseURL(server.URL))
	velocityAnalyzer := gh.NewVelocityAnalyzer(client, gh.WithAnalyzerBaseURL(server.URL))

	svc := crawler.NewService(
		&fakeInstallationLister{installations: []crawler.TenantInstallation{
			{TenantID: tenant1, InstallationID: 100},
			{TenantID: tenant2, InstallationID: 200},
		}},
		&discoveryAdapter{svc: discoverySvc},
		&velocityAdapter{analyzer: velocityAnalyzer},
		publisher,
		crawler.Config{MaxReposPerRun: 100, MaxRetries: 1, EventTopic: "velocity-metric-refreshed"},
	)

	result, err := svc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.TenantsProcessed != 2 {
		t.Errorf("TenantsProcessed = %d, want 2", result.TenantsProcessed)
	}

	// Each tenant gets its own events
	if len(publisher.events) != 2 {
		t.Fatalf("published %d events, want 2", len(publisher.events))
	}

	tenantIDs := map[string]bool{}
	for _, e := range publisher.events {
		evt := e.event.(crawler.VelocityMetricRefreshedEvent)
		tenantIDs[evt.TenantID] = true
	}

	if !tenantIDs[tenant1.String()] {
		t.Errorf("missing event for tenant1 %s", tenant1)
	}
	if !tenantIDs[tenant2.String()] {
		t.Errorf("missing event for tenant2 %s", tenant2)
	}
}
