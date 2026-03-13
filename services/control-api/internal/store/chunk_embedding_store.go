package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// RAGSearchResult is one retrieved chunk ranked by vector similarity.
type RAGSearchResult struct {
	ChunkID          uuid.UUID      `json:"chunk_id"`
	SourceDocumentID uuid.UUID      `json:"source_document_id"`
	FileName         string         `json:"file_name"`
	ChunkIndex       int            `json:"chunk_index"`
	Content          string         `json:"content"`
	MetadataJSON     map[string]any `json:"metadata_json"`
	SimilarityScore  float64        `json:"similarity_score"`
}

// ChunkEmbeddingStore provides retrieval operations for embedded chunks.
type ChunkEmbeddingStore interface {
	SearchSimilarChunks(ctx context.Context, tenantID uuid.UUID, queryEmbedding any, topK int, caseID *uuid.UUID) ([]RAGSearchResult, error)
}

// SQLChunkEmbeddingStore implements ChunkEmbeddingStore using PostgreSQL + pgvector.
type SQLChunkEmbeddingStore struct {
	db *sql.DB
}

// NewSQLChunkEmbeddingStore creates a SQLChunkEmbeddingStore backed by db.
func NewSQLChunkEmbeddingStore(db *sql.DB) *SQLChunkEmbeddingStore {
	return &SQLChunkEmbeddingStore{db: db}
}

// SearchSimilarChunks retrieves the closest active customer_docs chunks.
func (s *SQLChunkEmbeddingStore) SearchSimilarChunks(ctx context.Context, tenantID uuid.UUID, queryEmbedding any, topK int, caseID *uuid.UUID) ([]RAGSearchResult, error) {
	if topK <= 0 {
		return nil, fmt.Errorf("topK must be greater than zero")
	}

	vectorLiteral, err := pgvectorLiteral(queryEmbedding)
	if err != nil {
		return nil, err
	}

	const query = `
		SELECT
			dc.id,
			sd.id,
			sd.file_name,
			dc.chunk_index,
			dc.content,
			dc.metadata_json,
			1 - (ce.vector <=> $2::vector) AS similarity_score
		FROM chunk_embeddings ce
		JOIN document_chunks dc
			ON dc.id = ce.chunk_id
			AND dc.tenant_id = ce.tenant_id
			AND dc.source_type = 'source_document'
		JOIN source_documents sd
			ON dc.source_id = sd.id
			AND sd.tenant_id = ce.tenant_id
		WHERE ce.tenant_id = $1
			AND dc.tenant_id = $1
			AND ce.namespace = 'customer_docs'
			AND dc.namespace = ce.namespace
			AND ce.is_active = true
			AND ce.vector IS NOT NULL
			AND ($3::uuid IS NULL OR sd.case_id = $3)
		ORDER BY ce.vector <=> $2::vector ASC, dc.chunk_index ASC, dc.id ASC
		LIMIT $4
	`

	exec := executorFromContext(ctx, s.db)

	var caseFilter any
	if caseID != nil {
		caseFilter = *caseID
	}

	rows, err := exec.QueryContext(ctx, query, tenantID, vectorLiteral, caseFilter, topK)
	if err != nil {
		return nil, fmt.Errorf("search similar chunks: %w", err)
	}
	defer rows.Close()

	results := make([]RAGSearchResult, 0, topK)
	for rows.Next() {
		result, err := scanRAGSearchResult(rows)
		if err != nil {
			return nil, err
		}
		results = append(results, *result)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate similar chunks: %w", err)
	}

	return results, nil
}

func scanRAGSearchResult(scanner rowScanner) (*RAGSearchResult, error) {
	var (
		result      RAGSearchResult
		metadataRaw []byte
	)

	if err := scanner.Scan(
		&result.ChunkID,
		&result.SourceDocumentID,
		&result.FileName,
		&result.ChunkIndex,
		&result.Content,
		&metadataRaw,
		&result.SimilarityScore,
	); err != nil {
		return nil, fmt.Errorf("scan rag search result: %w", err)
	}
	result.MetadataJSON = map[string]any{}
	if len(metadataRaw) > 0 {
		if err := json.Unmarshal(metadataRaw, &result.MetadataJSON); err != nil {
			return nil, fmt.Errorf("decode rag search metadata: %w", err)
		}
	}

	return &result, nil
}

func pgvectorLiteral(queryEmbedding any) (string, error) {
	switch values := queryEmbedding.(type) {
	case []float32:
		return float32VectorLiteral(values)
	case []float64:
		return float64VectorLiteral(values)
	default:
		return "", fmt.Errorf("unsupported embedding type: %T", queryEmbedding)
	}
}

func float32VectorLiteral(values []float32) (string, error) {
	if len(values) == 0 {
		return "", fmt.Errorf("query embedding must not be empty")
	}

	var builder strings.Builder
	builder.WriteByte('[')
	for i, value := range values {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return "", fmt.Errorf("embedding contains non-finite value at index %d", i)
		}
		if i > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString(strconv.FormatFloat(float64(value), 'f', -1, 32))
	}
	builder.WriteByte(']')
	return builder.String(), nil
}

func float64VectorLiteral(values []float64) (string, error) {
	if len(values) == 0 {
		return "", fmt.Errorf("query embedding must not be empty")
	}

	var builder strings.Builder
	builder.WriteByte('[')
	for i, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return "", fmt.Errorf("embedding contains non-finite value at index %d", i)
		}
		if i > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString(strconv.FormatFloat(value, 'f', -1, 64))
	}
	builder.WriteByte(']')
	return builder.String(), nil
}
