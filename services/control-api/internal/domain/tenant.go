// Package domain defines the core domain types for the control-api service.
// Types are derived from the OpenAPI specification and initial-schema.sql,
// serving as the canonical Go representation of the Grift v2 data model.
package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Plan represents the subscription tier of a tenant.
type Plan string

const (
	// PlanFree is the default free tier.
	PlanFree Plan = "free"
	// PlanPro is the professional tier.
	PlanPro Plan = "pro"
	// PlanEnterprise is the enterprise tier.
	PlanEnterprise Plan = "enterprise"
)

// ValidPlans returns all valid Plan values.
func ValidPlans() []Plan {
	return []Plan{PlanFree, PlanPro, PlanEnterprise}
}

// IsValid reports whether the plan is a recognized value.
func (p Plan) IsValid() bool {
	switch p {
	case PlanFree, PlanPro, PlanEnterprise:
		return true
	}
	return false
}

// MemberRole represents a tenant member's role.
type MemberRole string

const (
	MemberRoleOwner   MemberRole = "owner"
	MemberRoleAdmin   MemberRole = "admin"
	MemberRoleManager MemberRole = "manager"
	MemberRoleMember  MemberRole = "member"
	MemberRoleViewer  MemberRole = "viewer"
)

// IsValid reports whether the role is a recognized value.
func (r MemberRole) IsValid() bool {
	switch r {
	case MemberRoleOwner, MemberRoleAdmin, MemberRoleManager, MemberRoleMember, MemberRoleViewer:
		return true
	}
	return false
}

// Tenant represents a multi-tenant organization in the system.
type Tenant struct {
	ID             uuid.UUID       `json:"id"`
	Name           string          `json:"name"`
	Slug           string          `json:"slug"`
	Plan           Plan            `json:"plan"`
	Settings       json.RawMessage `json:"settings"`
	AnalyticsOptIn bool            `json:"analytics_opt_in"`
	TrainingOptIn  bool            `json:"training_opt_in"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// TenantMember represents a user's membership within a tenant.
type TenantMember struct {
	ID          uuid.UUID  `json:"id"`
	TenantID    uuid.UUID  `json:"tenant_id"`
	FirebaseUID string     `json:"firebase_uid"`
	Email       *string    `json:"email,omitempty"`
	DisplayName *string    `json:"display_name,omitempty"`
	Role        MemberRole `json:"role"`
	Active      bool       `json:"active"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}
