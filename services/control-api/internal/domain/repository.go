package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// AccountType represents the type of GitHub account that installed the app.
type AccountType string

const (
	// AccountTypeOrganization is a GitHub organization account.
	AccountTypeOrganization AccountType = "Organization"
	// AccountTypeUser is a personal GitHub user account.
	AccountTypeUser AccountType = "User"
)

// IsValid reports whether the account type is a recognized value.
func (at AccountType) IsValid() bool {
	switch at {
	case AccountTypeOrganization, AccountTypeUser:
		return true
	}
	return false
}

// GitHubInstallation represents a GitHub App installation linked to a tenant.
type GitHubInstallation struct {
	ID             uuid.UUID       `json:"id"`
	TenantID       uuid.UUID       `json:"tenant_id"`
	InstallationID int64           `json:"installation_id"`
	AppID          int64           `json:"app_id"`
	AccountLogin   string          `json:"account_login"`
	AccountType    AccountType     `json:"account_type"`
	Permissions    json.RawMessage `json:"permissions"`
	Events         json.RawMessage `json:"events"`
	Active         bool            `json:"active"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// Repository represents a GitHub repository tracked within a tenant.
type Repository struct {
	ID               uuid.UUID  `json:"id"`
	TenantID         uuid.UUID  `json:"tenant_id"`
	InstallationID   *uuid.UUID `json:"installation_id,omitempty"`
	GitHubID         *int64     `json:"github_id,omitempty"`
	OrgName          *string    `json:"org_name,omitempty"`
	RepoName         string     `json:"repo_name"`
	FullName         string     `json:"full_name"`
	Description      *string    `json:"description,omitempty"`
	Language         *string    `json:"language,omitempty"`
	Stars            int        `json:"stars"`
	Topics           []string   `json:"topics"`
	TechStack        []string   `json:"tech_stack"`
	TotalCommits     int        `json:"total_commits"`
	ContributorCount int        `json:"contributor_count"`
	IsPrivate        bool       `json:"is_private"`
	IsArchived       bool       `json:"is_archived"`
	SyncedAt         *time.Time `json:"synced_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// VelocityMetric represents a point-in-time velocity analysis of a repository.
// This is an append-only record; each analysis produces a new row.
type VelocityMetric struct {
	ID               uuid.UUID `json:"id"`
	TenantID         uuid.UUID `json:"tenant_id"`
	RepositoryID     uuid.UUID `json:"repository_id"`
	CommitsPerWeek   *float64  `json:"commits_per_week,omitempty"`
	ActiveDaysPerWeek *float64 `json:"active_days_per_week,omitempty"`
	PRMergeFrequency *float64  `json:"pr_merge_frequency,omitempty"`
	IssueCloseSpeed  *float64  `json:"issue_close_speed,omitempty"`
	ChurnRate        *float64  `json:"churn_rate,omitempty"`
	ContributorCount *int      `json:"contributor_count,omitempty"`
	VelocityScore    *float64  `json:"velocity_score,omitempty"`
	EstimatedHours   *float64  `json:"estimated_hours,omitempty"`
	AnalyzedAt       time.Time `json:"analyzed_at"`
	CreatedAt        time.Time `json:"created_at"`
}

// IsScoreValid reports whether the velocity score is within the valid range [0, 100].
// Returns true if the score is nil (not yet computed).
func (vm *VelocityMetric) IsScoreValid() bool {
	if vm.VelocityScore == nil {
		return true
	}
	return *vm.VelocityScore >= 0 && *vm.VelocityScore <= 100
}
