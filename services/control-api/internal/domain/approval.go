package domain

import (
	"time"

	"github.com/google/uuid"
)

// ProposalStatus represents the lifecycle status of a proposal session.
type ProposalStatus string

const (
	ProposalStatusDraft     ProposalStatus = "draft"
	ProposalStatusPresented ProposalStatus = "presented"
	ProposalStatusApproved  ProposalStatus = "approved"
	ProposalStatusRejected  ProposalStatus = "rejected"
	ProposalStatusExpired   ProposalStatus = "expired"
)

// IsValid reports whether the proposal status is a recognized value.
func (ps ProposalStatus) IsValid() bool {
	switch ps {
	case ProposalStatusDraft, ProposalStatusPresented, ProposalStatusApproved,
		ProposalStatusRejected, ProposalStatusExpired:
		return true
	}
	return false
}

// Decision represents an approval or rejection outcome.
type Decision string

const (
	DecisionApproved Decision = "approved"
	DecisionRejected Decision = "rejected"
)

// IsValid reports whether the decision is a recognized value.
func (d Decision) IsValid() bool {
	switch d {
	case DecisionApproved, DecisionRejected:
		return true
	}
	return false
}

// ProposalSession represents a proposal presentation to a client.
type ProposalSession struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	CaseID      uuid.UUID      `json:"case_id"`
	EstimateID  uuid.UUID      `json:"estimate_id"`
	Status      ProposalStatus `json:"status"`
	PresentedAt *time.Time     `json:"presented_at,omitempty"`
	DecidedAt   *time.Time     `json:"decided_at,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

// ApprovalDecision records a go/no-go decision on a proposal.
type ApprovalDecision struct {
	ID            uuid.UUID `json:"id"`
	TenantID      uuid.UUID `json:"tenant_id"`
	ProposalID    uuid.UUID `json:"proposal_id"`
	Decision      Decision  `json:"decision"`
	DecidedByUID  string    `json:"decided_by_uid"`
	DecidedByRole *string   `json:"decided_by_role,omitempty"`
	Comment       *string   `json:"comment,omitempty"`
	DecidedAt     time.Time `json:"decided_at"`
	CreatedAt     time.Time `json:"created_at"`
}
