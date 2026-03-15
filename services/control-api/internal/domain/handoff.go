package domain

import (
	"time"

	"github.com/google/uuid"
)

// HandoffStatus represents handoff state machine.
type HandoffStatus string

const (
	HandoffStatusPending HandoffStatus = "pending"
	HandoffStatusSyncing HandoffStatus = "syncing"
	HandoffStatusSynced  HandoffStatus = "synced"
	HandoffStatusError   HandoffStatus = "error"
)

// HandoffPackage represents one queued or completed handoff.
type HandoffPackage struct {
	ID               uuid.UUID     `json:"id"`
	TenantID         uuid.UUID     `json:"tenant_id"`
	CaseID           uuid.UUID     `json:"case_id"`
	EstimateID       uuid.UUID     `json:"estimate_id"`
	LinearProjectID  *string       `json:"linear_project_id,omitempty"`
	LinearProjectURL *string       `json:"linear_project_url,omitempty"`
	GithubProjectURL *string       `json:"github_project_url,omitempty"`
	Status           HandoffStatus `json:"status"`
	ErrorMessage     *string       `json:"error_message,omitempty"`
	IdempotencyKey   uuid.UUID     `json:"idempotency_key"`
	CreatedAt        time.Time     `json:"created_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
}

// HandoffIssueMapping links a module or phase to external tracking artifacts.
type HandoffIssueMapping struct {
	ID                    uuid.UUID `json:"id"`
	TenantID              uuid.UUID `json:"tenant_id"`
	HandoffID             uuid.UUID `json:"handoff_id"`
	ModuleName            string    `json:"module_name"`
	PhaseName             *string   `json:"phase_name,omitempty"`
	LinearIssueID         *string   `json:"linear_issue_id,omitempty"`
	LinearIssueIdentifier *string   `json:"linear_issue_identifier,omitempty"`
	LinearIssueURL        *string   `json:"linear_issue_url,omitempty"`
	GithubIssueNumber     *int      `json:"github_issue_number,omitempty"`
	GithubIssueURL        *string   `json:"github_issue_url,omitempty"`
	HoursEstimate         *float64  `json:"hours_estimate,omitempty"`
	SourceEventID         *string   `json:"source_event_id,omitempty"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}
