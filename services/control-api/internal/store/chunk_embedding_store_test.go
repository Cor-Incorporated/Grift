package store

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestSQLChunkEmbeddingStore_SearchSimilarChunks(t *testing.T) {
	tenantID := uuid.New()
	caseID := uuid.New()
	chunkID := uuid.New()
	sourceDocumentID := uuid.New()
	metadata, _ := json.Marshal(map[string]any{"source_document_id": sourceDocumentID.String(), "token_count": float64(42)})
	secondChunkID := uuid.New()
	secondSourceDocumentID := uuid.New()
	secondMetadata, _ := json.Marshal(map[string]any{"source_document_id": secondSourceDocumentID.String(), "token_count": float64(21)})

	tests := []struct {
		name               string
		queryEmbedding     any
		caseID             *uuid.UUID
		topK               int
		mock               func(sqlmock.Sqlmock)
		wantCount          int
		wantContents       []string
		wantErr            string
		wantDetailedAssert bool
	}{
		{
			name:           "happy path with case filter",
			queryEmbedding: []float64{0.1, 0.2, 0.3},
			caseID:         &caseID,
			topK:           5,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT[\s\S]+WHERE ce\.tenant_id = \$1[\s\S]+dc\.tenant_id = \$1[\s\S]+ce\.namespace = 'customer_docs'[\s\S]+ORDER BY ce\.vector <=> \$2::vector ASC`).
					WithArgs(tenantID, "[0.1,0.2,0.3]", caseID, 5).
					WillReturnRows(sqlmock.NewRows([]string{
						"id", "source_id", "file_name", "chunk_index", "content", "metadata_json", "similarity_score",
					}).AddRow(
						chunkID, sourceDocumentID, "brief.pdf", 3, "matched content", metadata, 0.98,
					))
			},
			wantCount: 1,
			wantContents: []string{
				"matched content",
			},
			wantDetailedAssert: true,
		},
		{
			name:           "nil case filter uses null arg and float32 embedding",
			queryEmbedding: []float32{0.4, 0.5},
			caseID:         nil,
			topK:           3,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT[\s\S]+AND \(\$3::uuid IS NULL OR sd\.case_id = \$3\)[\s\S]+LIMIT \$4`).
					WithArgs(tenantID, "[0.4,0.5]", nil, 3).
					WillReturnRows(sqlmock.NewRows([]string{
						"id", "source_id", "file_name", "chunk_index", "content", "metadata_json", "similarity_score",
					}))
			},
			wantCount: 0,
		},
		{
			name:           "large result page preserves order",
			queryEmbedding: []float64{0.15, 0.25, 0.35},
			caseID:         &caseID,
			topK:           2,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT[\s\S]+ORDER BY ce\.vector <=> \$2::vector ASC, dc\.chunk_index ASC, dc\.id ASC[\s\S]+LIMIT \$4`).
					WithArgs(tenantID, "[0.15,0.25,0.35]", caseID, 2).
					WillReturnRows(sqlmock.NewRows([]string{
						"id", "source_id", "file_name", "chunk_index", "content", "metadata_json", "similarity_score",
					}).AddRow(
						chunkID, sourceDocumentID, "brief.pdf", 1, "first page result", metadata, 0.99,
					).AddRow(
						secondChunkID, secondSourceDocumentID, "appendix.pdf", 2, "second page result", secondMetadata, 0.97,
					))
			},
			wantCount: 2,
			wantContents: []string{
				"first page result",
				"second page result",
			},
		},
		{
			name:           "db error",
			queryEmbedding: []float64{0.9},
			caseID:         &caseID,
			topK:           2,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT[\s\S]+FROM chunk_embeddings ce`).
					WithArgs(tenantID, "[0.9]", caseID, 2).
					WillReturnError(errors.New("query timeout"))
			},
			wantErr: "search similar chunks",
		},
		{
			name:           "invalid metadata json",
			queryEmbedding: []float64{0.6},
			caseID:         &caseID,
			topK:           1,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT[\s\S]+FROM chunk_embeddings ce`).
					WithArgs(tenantID, "[0.6]", caseID, 1).
					WillReturnRows(sqlmock.NewRows([]string{
						"id", "source_id", "file_name", "chunk_index", "content", "metadata_json", "similarity_score",
					}).AddRow(
						chunkID, sourceDocumentID, "bad.pdf", 1, "bad metadata", []byte("{not-json"), 0.8,
					))
			},
			wantErr: "decode rag search metadata",
		},
		{
			name:           "top k passed through to limit arg",
			queryEmbedding: []float64{0.11, 0.22},
			caseID:         &caseID,
			topK:           7,
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT[\s\S]+LIMIT \$4`).
					WithArgs(tenantID, "[0.11,0.22]", caseID, 7).
					WillReturnRows(sqlmock.NewRows([]string{
						"id", "source_id", "file_name", "chunk_index", "content", "metadata_json", "similarity_score",
					}))
			},
			wantCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New() error = %v", err)
			}
			defer db.Close()

			tt.mock(mock)
			store := NewSQLChunkEmbeddingStore(db)

			results, err := store.SearchSimilarChunks(context.Background(), tenantID, tt.queryEmbedding, tt.topK, tt.caseID)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("SearchSimilarChunks() error = %v, want substring %q", err, tt.wantErr)
				}
			} else if err != nil {
				t.Fatalf("SearchSimilarChunks() unexpected error = %v", err)
			}

			if tt.wantErr == "" {
				if len(results) != tt.wantCount {
					t.Fatalf("len(results) = %d, want %d", len(results), tt.wantCount)
				}
				if len(tt.wantContents) > 0 {
					for i, wantContent := range tt.wantContents {
						if results[i].Content != wantContent {
							t.Fatalf("results[%d].Content = %q, want %q", i, results[i].Content, wantContent)
						}
					}
				}
				if tt.wantDetailedAssert {
					if results[0].SimilarityScore != 0.98 {
						t.Fatalf("SimilarityScore = %v, want 0.98", results[0].SimilarityScore)
					}
					if results[0].SourceDocumentID != sourceDocumentID {
						t.Fatalf("SourceDocumentID = %v, want %v", results[0].SourceDocumentID, sourceDocumentID)
					}
					if results[0].FileName != "brief.pdf" {
						t.Fatalf("FileName = %q, want %q", results[0].FileName, "brief.pdf")
					}
					if results[0].MetadataJSON["token_count"] != float64(42) {
						t.Fatalf("MetadataJSON[token_count] = %v, want 42", results[0].MetadataJSON["token_count"])
					}
				}
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLChunkEmbeddingStore_SearchSimilarChunksTenantIsolation(t *testing.T) {
	tenantA := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	tenantB := uuid.MustParse("ffffffff-1111-2222-3333-444444444444")
	caseID := uuid.New()
	vector := []float64{0.2, 0.4}
	chunkA := uuid.New()
	chunkB := uuid.New()
	sourceA := uuid.New()
	sourceB := uuid.New()
	metaA, _ := json.Marshal(map[string]any{"tenant": "a"})
	metaB, _ := json.Marshal(map[string]any{"tenant": "b"})

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT[\s\S]+WHERE ce\.tenant_id = \$1[\s\S]+LIMIT \$4`).
		WithArgs(tenantA, "[0.2,0.4]", caseID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "source_id", "file_name", "chunk_index", "content", "metadata_json", "similarity_score",
		}).AddRow(
			chunkA, sourceA, "tenant-a.pdf", 0, "tenant-a result", metaA, 0.95,
		))
	mock.ExpectQuery(`SELECT[\s\S]+WHERE ce\.tenant_id = \$1[\s\S]+LIMIT \$4`).
		WithArgs(tenantB, "[0.2,0.4]", caseID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "source_id", "file_name", "chunk_index", "content", "metadata_json", "similarity_score",
		}).AddRow(
			chunkB, sourceB, "tenant-b.pdf", 0, "tenant-b result", metaB, 0.94,
		))

	store := NewSQLChunkEmbeddingStore(db)

	resultsA, err := store.SearchSimilarChunks(context.Background(), tenantA, vector, 1, &caseID)
	if err != nil {
		t.Fatalf("SearchSimilarChunks() tenantA error = %v", err)
	}
	resultsB, err := store.SearchSimilarChunks(context.Background(), tenantB, vector, 1, &caseID)
	if err != nil {
		t.Fatalf("SearchSimilarChunks() tenantB error = %v", err)
	}

	if len(resultsA) != 1 || len(resultsB) != 1 {
		t.Fatalf("len(resultsA/resultsB) = %d/%d, want 1/1", len(resultsA), len(resultsB))
	}
	if resultsA[0].Content != "tenant-a result" {
		t.Fatalf("tenantA content = %q, want %q", resultsA[0].Content, "tenant-a result")
	}
	if resultsB[0].Content != "tenant-b result" {
		t.Fatalf("tenantB content = %q, want %q", resultsB[0].Content, "tenant-b result")
	}
	if resultsA[0].Content == resultsB[0].Content {
		t.Fatalf("tenant isolation failed, both contents = %q", resultsA[0].Content)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet() error = %v", err)
	}
}

func TestSQLChunkEmbeddingStore_SearchSimilarChunksRejectsInvalidInput(t *testing.T) {
	store := NewSQLChunkEmbeddingStore(nil)
	tenantID := uuid.New()
	caseID := uuid.New()

	tests := []struct {
		name           string
		queryEmbedding any
		topK           int
		wantErr        string
	}{
		{
			name:           "unsupported embedding type",
			queryEmbedding: []int{1, 2, 3},
			topK:           5,
			wantErr:        "unsupported embedding type",
		},
		{
			name:           "empty float64 embedding",
			queryEmbedding: []float64{},
			topK:           5,
			wantErr:        "query embedding must not be empty",
		},
		{
			name:           "non positive top k",
			queryEmbedding: []float64{0.1},
			topK:           0,
			wantErr:        "topK must be greater than zero",
		},
		{
			name:           "empty float32 embedding",
			queryEmbedding: []float32{},
			topK:           5,
			wantErr:        "query embedding must not be empty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := store.SearchSimilarChunks(context.Background(), tenantID, tt.queryEmbedding, tt.topK, &caseID)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("SearchSimilarChunks() error = %v, want substring %q", err, tt.wantErr)
			}
		})
	}
}

func TestPGVectorLiteral(t *testing.T) {
	tests := []struct {
		name      string
		input     any
		wantValue string
		wantErr   string
	}{
		{
			name:      "float64 literal",
			input:     []float64{0.1, 0.2, 0.3},
			wantValue: "[0.1,0.2,0.3]",
		},
		{
			name:      "float32 literal",
			input:     []float32{0.4, 0.5},
			wantValue: "[0.4,0.5]",
		},
		{
			name:    "float64 NaN rejected",
			input:   []float64{0.1, math.NaN(), 0.3},
			wantErr: "non-finite value at index 1",
		},
		{
			name:    "float64 +Inf rejected",
			input:   []float64{math.Inf(1), 0.2},
			wantErr: "non-finite value at index 0",
		},
		{
			name:    "float64 -Inf rejected",
			input:   []float64{0.1, math.Inf(-1)},
			wantErr: "non-finite value at index 1",
		},
		{
			name:    "float32 NaN rejected",
			input:   []float32{float32(math.NaN()), 0.5},
			wantErr: "non-finite value at index 0",
		},
		{
			name:    "float32 Inf rejected",
			input:   []float32{0.4, float32(math.Inf(1))},
			wantErr: "non-finite value at index 1",
		},
		{
			name:    "unsupported type",
			input:   "nope",
			wantErr: "unsupported embedding type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := pgvectorLiteral(tt.input)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("pgvectorLiteral() error = %v, want substring %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("pgvectorLiteral() unexpected error = %v", err)
			}
			if got != tt.wantValue {
				t.Fatalf("pgvectorLiteral() = %q, want %q", got, tt.wantValue)
			}
		})
	}
}
