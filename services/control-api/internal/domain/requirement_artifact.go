package domain

import (
	"time"

	"github.com/google/uuid"
)

// ArtifactStatus represents the lifecycle status of a requirement artifact.
type ArtifactStatus string

const (
	ArtifactStatusDraft     ArtifactStatus = "draft"
	ArtifactStatusFinalized ArtifactStatus = "finalized"
)

// IsValid reports whether the artifact status is a recognized value.
func (as ArtifactStatus) IsValid() bool {
	switch as {
	case ArtifactStatusDraft, ArtifactStatusFinalized:
		return true
	}
	return false
}

// RequirementArtifact represents a versioned requirement specification
// derived from conversation turns and source documents.
type RequirementArtifact struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	CaseID       uuid.UUID      `json:"case_id"`
	Version      int            `json:"version"`
	Markdown     string         `json:"markdown"`
	SourceChunks []uuid.UUID    `json:"source_chunks"`
	Status       ArtifactStatus `json:"status"`
	CreatedByUID *string        `json:"created_by_uid,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}
