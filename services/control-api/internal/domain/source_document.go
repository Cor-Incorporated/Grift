package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// SourceKind identifies how a source document was provided.
type SourceKind string

const (
	// SourceKindFileUpload indicates a directly uploaded file.
	SourceKindFileUpload SourceKind = "file_upload"
	// SourceKindRepositoryURL indicates a repository URL source.
	SourceKindRepositoryURL SourceKind = "repository_url"
	// SourceKindWebsiteURL indicates a non-repository website URL source.
	SourceKindWebsiteURL SourceKind = "website_url"
)

// SourceDocumentStatus tracks ingestion progress for a source document.
type SourceDocumentStatus string

const (
	SourceDocumentStatusPending    SourceDocumentStatus = "pending"
	SourceDocumentStatusProcessing SourceDocumentStatus = "processing"
	SourceDocumentStatusCompleted  SourceDocumentStatus = "completed"
	SourceDocumentStatusFailed     SourceDocumentStatus = "failed"
)

// SourceDocument stores uploaded or linked source material for a case.
type SourceDocument struct {
	ID             uuid.UUID            `json:"id"`
	TenantID       uuid.UUID            `json:"tenant_id"`
	CaseID         uuid.UUID            `json:"case_id"`
	FileName       string               `json:"file_name"`
	FileType       *string              `json:"file_type,omitempty"`
	FileSize       *int64               `json:"file_size,omitempty"`
	SourceKind     SourceKind           `json:"source_kind"`
	SourceURL      *string              `json:"source_url,omitempty"`
	GCSPath        *string              `json:"gcs_path,omitempty"`
	Status         SourceDocumentStatus `json:"status"`
	AnalysisError  *string              `json:"analysis_error,omitempty"`
	AnalysisResult json.RawMessage      `json:"analysis_result,omitempty"`
	AnalyzedAt     *time.Time           `json:"analyzed_at,omitempty"`
	CreatedAt      time.Time            `json:"created_at"`
	UpdatedAt      time.Time            `json:"updated_at"`
}
