package sourcedocument

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/google/uuid"
)

// Store provides persistence operations for source documents.
type Store interface {
	Create(ctx context.Context, doc *domain.SourceDocument) error
	ListByCase(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.SourceDocument, int, error)
}

// SQLStore persists source documents using PostgreSQL.
type SQLStore struct {
	DB *sql.DB
}

type queryExecer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (s *SQLStore) queryer(ctx context.Context) queryExecer {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return s.DB
}

// Create inserts a new source_documents row.
func (s *SQLStore) Create(ctx context.Context, doc *domain.SourceDocument) error {
	if s == nil || s.DB == nil {
		return fmt.Errorf("source document store not configured")
	}
	if doc.ID == uuid.Nil {
		doc.ID = uuid.New()
	}

	const query = `
		INSERT INTO source_documents (
			id, tenant_id, case_id, file_name, file_type, file_size,
			source_kind, source_url, gcs_path, status
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10
		)
		RETURNING created_at, updated_at
	`

	err := s.queryer(ctx).QueryRowContext(ctx, query,
		doc.ID,
		doc.TenantID,
		doc.CaseID,
		doc.FileName,
		doc.FileType,
		doc.FileSize,
		doc.SourceKind,
		doc.SourceURL,
		doc.GCSPath,
		doc.Status,
	).Scan(&doc.CreatedAt, &doc.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create source document: %w", err)
	}
	return nil
}

// ListByCase returns paginated source documents for a tenant-scoped case.
func (s *SQLStore) ListByCase(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.SourceDocument, int, error) {
	if s == nil || s.DB == nil {
		return nil, 0, fmt.Errorf("source document store not configured")
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	const countQuery = `
		SELECT COUNT(*)
		FROM source_documents
		WHERE tenant_id = $1 AND case_id = $2
	`
	var total int
	if err := s.queryer(ctx).QueryRowContext(ctx, countQuery, tenantID, caseID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count source documents: %w", err)
	}

	const listQuery = `
		SELECT id, tenant_id, case_id, file_name, file_type, file_size,
			source_kind, source_url, gcs_path, status, analysis_error,
			analysis_result, analyzed_at, created_at, updated_at
		FROM source_documents
		WHERE tenant_id = $1 AND case_id = $2
		ORDER BY created_at DESC
		LIMIT $3 OFFSET $4
	`
	rows, err := s.queryer(ctx).QueryContext(ctx, listQuery, tenantID, caseID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list source documents: %w", err)
	}
	defer rows.Close()

	docs := make([]domain.SourceDocument, 0, limit)
	for rows.Next() {
		var doc domain.SourceDocument
		var fileType sql.NullString
		var fileSize sql.NullInt64
		var sourceURL sql.NullString
		var gcsPath sql.NullString
		var status string
		var analysisError sql.NullString
		var analysisResult []byte
		var analyzedAt sql.NullTime

		if err := rows.Scan(
			&doc.ID,
			&doc.TenantID,
			&doc.CaseID,
			&doc.FileName,
			&fileType,
			&fileSize,
			&doc.SourceKind,
			&sourceURL,
			&gcsPath,
			&status,
			&analysisError,
			&analysisResult,
			&analyzedAt,
			&doc.CreatedAt,
			&doc.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan source document: %w", err)
		}

		if fileType.Valid {
			v := fileType.String
			doc.FileType = &v
		}
		if fileSize.Valid {
			v := fileSize.Int64
			doc.FileSize = &v
		}
		if sourceURL.Valid {
			v := sourceURL.String
			doc.SourceURL = &v
		}
		if gcsPath.Valid {
			v := gcsPath.String
			doc.GCSPath = &v
		}
		doc.Status = domain.SourceDocumentStatus(status)
		if analysisError.Valid {
			v := analysisError.String
			doc.AnalysisError = &v
		}
		if len(analysisResult) > 0 {
			doc.AnalysisResult = analysisResult
		}
		if analyzedAt.Valid {
			v := analyzedAt.Time
			doc.AnalyzedAt = &v
		}
		docs = append(docs, doc)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate source documents: %w", err)
	}
	return docs, total, nil
}
