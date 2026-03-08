package domain

import (
	"time"

	"github.com/google/uuid"
)

// CaseType represents the classification of a case.
type CaseType string

const (
	CaseTypeNewProject      CaseType = "new_project"
	CaseTypeBugReport       CaseType = "bug_report"
	CaseTypeFixRequest      CaseType = "fix_request"
	CaseTypeFeatureAddition CaseType = "feature_addition"
	CaseTypeUndetermined    CaseType = "undetermined"
)

// IsValid reports whether the case type is a recognized value.
func (ct CaseType) IsValid() bool {
	switch ct {
	case CaseTypeNewProject, CaseTypeBugReport, CaseTypeFixRequest,
		CaseTypeFeatureAddition, CaseTypeUndetermined:
		return true
	}
	return false
}

// CaseStatus represents the workflow status of a case.
type CaseStatus string

const (
	CaseStatusDraft        CaseStatus = "draft"
	CaseStatusInterviewing CaseStatus = "interviewing"
	CaseStatusAnalyzing    CaseStatus = "analyzing"
	CaseStatusEstimating   CaseStatus = "estimating"
	CaseStatusProposed     CaseStatus = "proposed"
	CaseStatusApproved     CaseStatus = "approved"
	CaseStatusRejected     CaseStatus = "rejected"
	CaseStatusOnHold       CaseStatus = "on_hold"
)

// IsValid reports whether the case status is a recognized value.
func (cs CaseStatus) IsValid() bool {
	switch cs {
	case CaseStatusDraft, CaseStatusInterviewing, CaseStatusAnalyzing,
		CaseStatusEstimating, CaseStatusProposed, CaseStatusApproved,
		CaseStatusRejected, CaseStatusOnHold:
		return true
	}
	return false
}

// CasePriority represents the urgency level of a case.
type CasePriority string

const (
	CasePriorityLow      CasePriority = "low"
	CasePriorityMedium   CasePriority = "medium"
	CasePriorityHigh     CasePriority = "high"
	CasePriorityCritical CasePriority = "critical"
)

// IsValid reports whether the priority is a recognized value.
func (cp CasePriority) IsValid() bool {
	switch cp {
	case CasePriorityLow, CasePriorityMedium, CasePriorityHigh, CasePriorityCritical:
		return true
	}
	return false
}

// Case represents an intake case (project request, bug report, etc.).
type Case struct {
	ID                uuid.UUID     `json:"id"`
	TenantID          uuid.UUID     `json:"tenant_id"`
	Title             string        `json:"title"`
	Type              CaseType      `json:"type"`
	Status            CaseStatus    `json:"status"`
	Priority          *CasePriority `json:"priority,omitempty"`
	BusinessLine      *string       `json:"business_line,omitempty"`
	ExistingSystemURL *string       `json:"existing_system_url,omitempty"`
	SpecMarkdown      *string       `json:"spec_markdown,omitempty"`
	ContactName       *string       `json:"contact_name,omitempty"`
	ContactEmail      *string       `json:"contact_email,omitempty"`
	CompanyName       *string       `json:"company_name,omitempty"`
	CreatedByUID      *string       `json:"created_by_uid,omitempty"`
	CreatedAt         time.Time     `json:"created_at"`
	UpdatedAt         time.Time     `json:"updated_at"`
}
