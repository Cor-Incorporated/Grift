package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	velocityDefaultBaseURL = "https://api.github.com"
	// maxVelocityResponseBody limits response body reads to 10 MB.
	maxVelocityResponseBody = 10 * 1024 * 1024
)

// validateSlug rejects owner/repo values that could cause path traversal
// or URL injection (e.g. containing "/?#" or "..").
func validateSlug(s string) error {
	if s == "" || strings.ContainsAny(s, "/?#") || strings.Contains(s, "..") {
		return fmt.Errorf("invalid slug: %q", s)
	}
	return nil
}

// RawVelocityData holds raw data fetched from GitHub API endpoints.
type RawVelocityData struct {
	WeeklyCommits    []int          // last 13 weeks of commit counts
	MergedPRCount    int            // merged PRs in the last 90 days
	AvgIssueCloseHrs float64        // average hours to close issues
	ContributorCount int            // unique contributors
	Languages        map[string]int64 // language -> bytes
	TotalCommits     int            // total commits in the period
	ActiveDays       int            // days with at least 1 commit in 90 days
}

// NormalizedMetrics contains velocity metrics normalized to standard scales.
type NormalizedMetrics struct {
	CommitsPerWeek    float64
	ActiveDaysPerWeek float64
	PRMergeFrequency  float64
	IssueCloseSpeed   float64
	ChurnRate         float64
	ContributorCount  int
	VelocityScore     float64
}

// VelocityOption configures a VelocityAnalyzer.
type VelocityOption func(*VelocityAnalyzer)

// WithAnalyzerBaseURL overrides the GitHub API base URL for the analyzer.
func WithAnalyzerBaseURL(url string) VelocityOption {
	return func(va *VelocityAnalyzer) {
		va.baseURL = url
	}
}

// VelocityAnalyzer extracts velocity metrics from GitHub API data.
type VelocityAnalyzer struct {
	client  *Client
	baseURL string
}

// NewVelocityAnalyzer creates a VelocityAnalyzer with the given client and options.
func NewVelocityAnalyzer(client *Client, opts ...VelocityOption) *VelocityAnalyzer {
	va := &VelocityAnalyzer{
		client:  client,
		baseURL: velocityDefaultBaseURL,
	}
	for _, opt := range opts {
		opt(va)
	}
	return va
}

// Analyze fetches raw velocity data from GitHub API for the given repository.
// It collects commit activity, PR merge frequency, issue close speed,
// contributor counts, and language breakdown for the last 90 days.
func (va *VelocityAnalyzer) Analyze(ctx context.Context, owner, repo string) (*RawVelocityData, error) {
	if err := validateSlug(owner); err != nil {
		return nil, fmt.Errorf("invalid owner: %w", err)
	}
	if err := validateSlug(repo); err != nil {
		return nil, fmt.Errorf("invalid repo: %w", err)
	}

	raw := &RawVelocityData{
		Languages: make(map[string]int64),
	}

	// 1. Commit activity (last 52 weeks, we take last 13)
	weeklyCommits, totalCommits, activeDays, err := va.fetchCommitActivity(ctx, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("fetching commit activity: %w", err)
	}
	raw.WeeklyCommits = weeklyCommits
	raw.TotalCommits = totalCommits
	raw.ActiveDays = activeDays

	// 2. Merged PR count in last 90 days
	mergedPRs, err := va.fetchMergedPRCount(ctx, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("fetching merged PRs: %w", err)
	}
	raw.MergedPRCount = mergedPRs

	// 3. Average issue close time
	avgCloseHrs, err := va.fetchIssueCloseSpeed(ctx, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("fetching issue close speed: %w", err)
	}
	raw.AvgIssueCloseHrs = avgCloseHrs

	// 4. Contributor count
	contributors, err := va.fetchContributorCount(ctx, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("fetching contributors: %w", err)
	}
	raw.ContributorCount = contributors

	// 5. Languages
	langs, err := va.fetchLanguages(ctx, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("fetching languages: %w", err)
	}
	raw.Languages = langs

	return raw, nil
}

// Normalize converts raw GitHub API data to normalized velocity metrics.
// All scores are bounded to prevent overflow from extreme values.
func (va *VelocityAnalyzer) Normalize(raw *RawVelocityData) *NormalizedMetrics {
	if raw == nil {
		return &NormalizedMetrics{}
	}

	const weeks = 13.0

	// commits_per_week = avg(WeeklyCommits)
	var cpw float64
	if len(raw.WeeklyCommits) > 0 {
		sum := 0
		for _, c := range raw.WeeklyCommits {
			sum += c
		}
		cpw = float64(sum) / float64(len(raw.WeeklyCommits))
	}

	// active_days_per_week = ActiveDays / 13.0
	adpw := float64(raw.ActiveDays) / weeks

	// pr_merge_frequency = MergedPRCount / 13.0 (per week)
	pmf := float64(raw.MergedPRCount) / weeks

	// issue_close_speed = AvgIssueCloseHrs (lower is better)
	ics := raw.AvgIssueCloseHrs

	// churn_rate = 0.0 (placeholder)
	churnRate := 0.0

	// velocity_score = weighted combination (each component 0-25, total 0-100)
	commitScore := math.Min(cpw/20.0, 1.0) * 25.0
	prScore := math.Min(pmf/10.0, 1.0) * 25.0
	activeScore := math.Min(adpw/5.0, 1.0) * 25.0
	contributorScore := math.Min(float64(raw.ContributorCount)/10.0, 1.0) * 25.0

	velocityScore := commitScore + prScore + activeScore + contributorScore
	// Cap at 100
	velocityScore = math.Min(velocityScore, 100.0)

	return &NormalizedMetrics{
		CommitsPerWeek:    cpw,
		ActiveDaysPerWeek: adpw,
		PRMergeFrequency:  pmf,
		IssueCloseSpeed:   ics,
		ChurnRate:         churnRate,
		ContributorCount:  raw.ContributorCount,
		VelocityScore:     velocityScore,
	}
}

// commitActivityResponse represents a single week from the commit_activity endpoint.
type commitActivityResponse struct {
	Total int   `json:"total"`
	Week  int64 `json:"week"` // Unix timestamp of the start of the week
	Days  []int `json:"days"` // commits per day (Sun-Sat)
}

func (va *VelocityAnalyzer) fetchCommitActivity(ctx context.Context, owner, repo string) (weeklyCommits []int, totalCommits int, activeDays int, err error) {
	url := fmt.Sprintf("%s/repos/%s/%s/stats/commit_activity", va.baseURL, owner, repo)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("creating request: %w", err)
	}

	resp, err := va.doWithRateLimit(ctx, req)
	if err != nil {
		return nil, 0, 0, err
	}

	body, err := readBody(resp)
	if err != nil {
		return nil, 0, 0, err
	}

	// GitHub returns 202 when stats are being computed; treat as "no data yet".
	if resp.StatusCode == http.StatusAccepted {
		return nil, 0, 0, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, 0, 0, fmt.Errorf("commit activity API returned %d: %s", resp.StatusCode, truncate(body, 200))
	}

	var weeks []commitActivityResponse
	if err := json.Unmarshal(body, &weeks); err != nil {
		return nil, 0, 0, fmt.Errorf("decoding commit activity: %w", err)
	}

	// Take the last 13 weeks
	start := 0
	if len(weeks) > 13 {
		start = len(weeks) - 13
	}
	recent := weeks[start:]

	weeklyCommits = make([]int, 0, len(recent))
	for _, w := range recent {
		weeklyCommits = append(weeklyCommits, w.Total)
		totalCommits += w.Total
		for _, d := range w.Days {
			if d > 0 {
				activeDays++
			}
		}
	}

	return weeklyCommits, totalCommits, activeDays, nil
}

// pullResponse is a minimal representation of a GitHub pull request.
type pullResponse struct {
	MergedAt *time.Time `json:"merged_at"`
}

func (va *VelocityAnalyzer) fetchMergedPRCount(ctx context.Context, owner, repo string) (int, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/pulls?state=closed&sort=updated&direction=desc&per_page=100", va.baseURL, owner, repo)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, fmt.Errorf("creating request: %w", err)
	}

	resp, err := va.doWithRateLimit(ctx, req)
	if err != nil {
		return 0, err
	}

	body, err := readBody(resp)
	if err != nil {
		return 0, err
	}

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("pulls API returned %d: %s", resp.StatusCode, truncate(body, 200))
	}

	var pulls []pullResponse
	if err := json.Unmarshal(body, &pulls); err != nil {
		return 0, fmt.Errorf("decoding pulls: %w", err)
	}

	cutoff := time.Now().AddDate(0, 0, -90)
	count := 0
	for _, pr := range pulls {
		if pr.MergedAt != nil && pr.MergedAt.After(cutoff) {
			count++
		}
	}
	return count, nil
}

// issueResponse is a minimal representation of a GitHub issue.
type issueResponse struct {
	CreatedAt time.Time  `json:"created_at"`
	ClosedAt  *time.Time `json:"closed_at"`
}

func (va *VelocityAnalyzer) fetchIssueCloseSpeed(ctx context.Context, owner, repo string) (float64, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/issues?state=closed&sort=updated&direction=desc&per_page=100", va.baseURL, owner, repo)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, fmt.Errorf("creating request: %w", err)
	}

	resp, err := va.doWithRateLimit(ctx, req)
	if err != nil {
		return 0, err
	}

	body, err := readBody(resp)
	if err != nil {
		return 0, err
	}

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("issues API returned %d: %s", resp.StatusCode, truncate(body, 200))
	}

	var issues []issueResponse
	if err := json.Unmarshal(body, &issues); err != nil {
		return 0, fmt.Errorf("decoding issues: %w", err)
	}

	cutoff := time.Now().AddDate(0, 0, -90)
	var totalHours float64
	count := 0
	for _, issue := range issues {
		if issue.ClosedAt == nil || issue.ClosedAt.Before(cutoff) {
			continue
		}
		hours := issue.ClosedAt.Sub(issue.CreatedAt).Hours()
		if hours >= 0 {
			totalHours += hours
			count++
		}
	}

	if count == 0 {
		return 0, nil
	}
	return totalHours / float64(count), nil
}

// contributorResponse is a minimal representation of a GitHub contributor stats entry.
type contributorResponse struct {
	Total int `json:"total"`
}

func (va *VelocityAnalyzer) fetchContributorCount(ctx context.Context, owner, repo string) (int, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/stats/contributors", va.baseURL, owner, repo)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, fmt.Errorf("creating request: %w", err)
	}

	resp, err := va.doWithRateLimit(ctx, req)
	if err != nil {
		return 0, err
	}

	body, err := readBody(resp)
	if err != nil {
		return 0, err
	}

	// GitHub returns 202 when stats are being computed; treat as "no data yet".
	if resp.StatusCode == http.StatusAccepted {
		return 0, nil
	}

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("contributors API returned %d: %s", resp.StatusCode, truncate(body, 200))
	}

	var contributors []contributorResponse
	if err := json.Unmarshal(body, &contributors); err != nil {
		return 0, fmt.Errorf("decoding contributors: %w", err)
	}

	return len(contributors), nil
}

func (va *VelocityAnalyzer) fetchLanguages(ctx context.Context, owner, repo string) (map[string]int64, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/languages", va.baseURL, owner, repo)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := va.doWithRateLimit(ctx, req)
	if err != nil {
		return nil, err
	}

	body, err := readBody(resp)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("languages API returned %d: %s", resp.StatusCode, truncate(body, 200))
	}

	langs := make(map[string]int64)
	if err := json.Unmarshal(body, &langs); err != nil {
		return nil, fmt.Errorf("decoding languages: %w", err)
	}

	return langs, nil
}

// ErrRateLimited is returned when the GitHub API rate limit is exceeded
// and the wait time exceeds the acceptable threshold.
type ErrRateLimited struct {
	ResetAt time.Time
}

func (e *ErrRateLimited) Error() string {
	return fmt.Sprintf("github rate limit exceeded, resets at %s", e.ResetAt.Format(time.RFC3339))
}

// doWithRateLimit executes a request via the client, handling 403 rate limit responses.
// If X-RateLimit-Remaining is 0 and wait time < 60s, it retries once after sleeping.
// If wait time > 60s or context deadline would be exceeded, it returns an error.
func (va *VelocityAnalyzer) doWithRateLimit(ctx context.Context, req *http.Request) (*http.Response, error) {
	resp, err := va.client.Do(ctx, req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusForbidden {
		return resp, nil
	}

	remaining := resp.Header.Get("X-RateLimit-Remaining")
	if remaining != "0" {
		// Not a rate limit issue, return as-is
		return resp, nil
	}

	// Close the 403 response body before retry
	body, _ := readBody(resp)

	resetStr := resp.Header.Get("X-RateLimit-Reset")
	if resetStr == "" {
		return nil, fmt.Errorf("rate limited but no X-RateLimit-Reset header: %s", truncate(body, 200))
	}

	resetUnix, err := strconv.ParseInt(resetStr, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parsing X-RateLimit-Reset: %w", err)
	}

	resetAt := time.Unix(resetUnix, 0)
	waitDuration := time.Until(resetAt)

	if waitDuration > 60*time.Second {
		return nil, &ErrRateLimited{ResetAt: resetAt}
	}

	// Check context deadline
	if deadline, ok := ctx.Deadline(); ok && time.Now().Add(waitDuration).After(deadline) {
		return nil, &ErrRateLimited{ResetAt: resetAt}
	}

	if waitDuration > 0 {
		timer := time.NewTimer(waitDuration)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}

	// Retry the request once
	retryReq, err := http.NewRequestWithContext(ctx, req.Method, req.URL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("creating retry request: %w", err)
	}
	retryReq.Header = req.Header.Clone()

	return va.client.Do(ctx, retryReq)
}

// truncate returns the first n bytes of data as a string.
func truncate(data []byte, n int) string {
	if len(data) <= n {
		return string(data)
	}
	return string(data[:n]) + "..."
}

// readBody reads the response body with a size limit and closes it.
func readBody(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxVelocityResponseBody))
	if err != nil {
		return nil, fmt.Errorf("reading response body: %w", err)
	}
	return data, nil
}
