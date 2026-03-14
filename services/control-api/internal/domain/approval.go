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

// GoNoGoDecision represents the automated go/no-go evaluation outcome.
type GoNoGoDecision string

const (
	GoNoGoDecisionGo               GoNoGoDecision = "go"
	GoNoGoDecisionGoWithConditions GoNoGoDecision = "go_with_conditions"
	GoNoGoDecisionNoGo             GoNoGoDecision = "no_go"
)

// IsValid reports whether the go/no-go decision is a recognized value.
func (d GoNoGoDecision) IsValid() bool {
	switch d {
	case GoNoGoDecisionGo, GoNoGoDecisionGoWithConditions, GoNoGoDecisionNoGo:
		return true
	}
	return false
}

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
	TenantID    uuid.UUID      `json:"-"`
	CaseID      uuid.UUID      `json:"case_id"`
	EstimateID  uuid.UUID      `json:"estimate_id"`
	Status      ProposalStatus `json:"status"`
	PresentedAt *time.Time     `json:"presented_at,omitempty"`
	DecidedAt   *time.Time     `json:"decided_at,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"-"`
}

// ApprovalDecision records a go/no-go decision on a proposal.
type ApprovalDecision struct {
	ID            uuid.UUID `json:"id"`
	TenantID      uuid.UUID `json:"-"`
	ProposalID    uuid.UUID `json:"proposal_id"`
	Decision      Decision  `json:"decision"`
	DecidedByUID  string    `json:"decided_by_uid"`
	DecidedByRole *string   `json:"-"`
	Comment       *string   `json:"comment,omitempty"`
	DecidedAt     time.Time `json:"decided_at"`
	CreatedAt     time.Time `json:"-"`
}

// GoNoGoResult captures the evaluation payload returned by the proposal workflow.
type GoNoGoResult struct {
	Decision           GoNoGoDecision     `json:"decision"`
	Scores             map[string]float64 `json:"scores"`
	Weights            map[string]float64 `json:"weights"`
	Reasoning          string             `json:"reasoning"`
	BigQueryAdjustment *float64           `json:"bigquery_adjustment,omitempty"`
}
