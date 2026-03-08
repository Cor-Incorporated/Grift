// Package crawler implements the periodic repository crawl job that discovers
// repositories and extracts velocity metrics for all active tenant installations.
package crawler

import "time"

// VelocityMetricRefreshedEvent is published when a repository's velocity
// metrics have been successfully analyzed and stored.
type VelocityMetricRefreshedEvent struct {
	TenantID      string    `json:"tenant_id"`
	RepositoryID  string    `json:"repository_id"`
	RepoFullName  string    `json:"repo_full_name"`
	VelocityScore float64   `json:"velocity_score"`
	AnalyzedAt    time.Time `json:"analyzed_at"`
	Version       string    `json:"version"`
}
