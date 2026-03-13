package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/llmclient"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

type ragSearchCall struct {
	tenantID uuid.UUID
	caseID   *uuid.UUID
	topK     int
	vector   []float64
}

type mockRAGSearchStore struct {
	results         []store.RAGSearchResult
	resultsByTenant map[uuid.UUID][]store.RAGSearchResult
	err             error
	errByTenant     map[uuid.UUID]error
	calls           []ragSearchCall
}

func (m *mockRAGSearchStore) SearchSimilarChunks(_ context.Context, tenantID uuid.UUID, queryEmbedding any, topK int, caseID *uuid.UUID) ([]store.RAGSearchResult, error) {
	call := ragSearchCall{
		tenantID: tenantID,
		caseID:   caseID,
		topK:     topK,
	}
	switch values := queryEmbedding.(type) {
	case []float64:
		call.vector = append([]float64(nil), values...)
	case []float32:
		call.vector = make([]float64, len(values))
		for i, value := range values {
			call.vector[i] = float64(value)
		}
	}
	m.calls = append(m.calls, call)

	if err := m.errByTenant[tenantID]; err != nil {
		return nil, err
	}
	if m.err != nil {
		return nil, m.err
	}
	if m.resultsByTenant != nil {
		return append([]store.RAGSearchResult(nil), m.resultsByTenant[tenantID]...), nil
	}
	return append([]store.RAGSearchResult(nil), m.results...), nil
}

// NOTE: mockRAGEmbedder.callCount and mockRAGSearchStore.calls are not thread-safe.
// If t.Parallel() is added to subtests, these fields must use sync/atomic or a mutex.
type mockRAGEmbedder struct {
	response  *llmclient.EmbeddingResponse
	err       error
	callCount int
	lastInput string
}

func (m *mockRAGEmbedder) Embed(_ context.Context, input string, _ llmclient.EmbeddingOptions) (*llmclient.EmbeddingResponse, error) {
	m.callCount++
	m.lastInput = input
	if m.err != nil {
		return nil, m.err
	}
	return m.response, nil
}

func newRAGSearchHTTPHandler(storeMock store.ChunkEmbeddingStore, embedder ragQueryEmbedder) http.Handler {
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, NewRAGSearchHandler(storeMock, embedder))
	return middleware.Tenant(mux)
}

func decodeRAGSearchResponse(t *testing.T, rec *httptest.ResponseRecorder) struct {
	Data  []store.RAGSearchResult `json:"data"`
	Error string                  `json:"error"`
} {
	t.Helper()

	var body struct {
		Data  []store.RAGSearchResult `json:"data"`
		Error string                  `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	return body
}

func TestRAGSearchHandlerSearchHTTPResponses(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	largeResults := make([]store.RAGSearchResult, 0, maxRAGTopK)
	for i := 0; i < maxRAGTopK; i++ {
		largeResults = append(largeResults, store.RAGSearchResult{
			ChunkID:          uuid.New(),
			SourceDocumentID: uuid.New(),
			FileName:         "brief.pdf",
			ChunkIndex:       i,
			Content:          "chunk " + strings.Repeat("x", i%3),
			MetadataJSON:     map[string]any{"rank": float64(i + 1)},
			SimilarityScore:  0.99 - float64(i)*0.01,
		})
	}

	tests := []struct {
		name            string
		path            string
		tenantHeader    string
		storeMock       *mockRAGSearchStore
		embedder        *mockRAGEmbedder
		wantStatus      int
		wantError       string
		wantResultCount int
		wantTopK        int
		wantTenantID    uuid.UUID
		wantCaseID      *uuid.UUID
		wantEmbedInput  string
		wantEmbedCalls  int
		wantStoreCalls  int
	}{
		{
			name:         "not configured returns service unavailable",
			path:         "/v1/cases/" + caseID.String() + "/search?q=policy",
			tenantHeader: tenantID.String(),
			wantStatus:   http.StatusServiceUnavailable,
			wantError:    "rag search not configured",
		},
		{
			name:         "success with explicit top k",
			path:         "/v1/cases/" + caseID.String() + "/search?q=need+invoice+rules&top_k=7",
			tenantHeader: tenantID.String(),
			storeMock: &mockRAGSearchStore{
				results: []store.RAGSearchResult{{
					ChunkID:          uuid.New(),
					SourceDocumentID: uuid.New(),
					FileName:         "brief.pdf",
					ChunkIndex:       2,
					Content:          "matching chunk",
					MetadataJSON:     map[string]any{"source_document_id": uuid.New().String()},
					SimilarityScore:  0.92,
				}},
			},
			embedder: &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{
					Model:     "text-embedding-3-small",
					Embedding: []float64{0.1, 0.2, 0.3},
				},
			},
			wantStatus:      http.StatusOK,
			wantResultCount: 1,
			wantTopK:        7,
			wantTenantID:    tenantID,
			wantCaseID:      &caseID,
			wantEmbedInput:  "need invoice rules",
			wantEmbedCalls:  1,
			wantStoreCalls:  1,
		},
		{
			name:         "zero results returns empty array",
			path:         "/v1/cases/" + caseID.String() + "/search?q=policy",
			tenantHeader: tenantID.String(),
			storeMock:    &mockRAGSearchStore{},
			embedder: &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
			},
			wantStatus:      http.StatusOK,
			wantResultCount: 0,
			wantTopK:        defaultRAGTopK,
			wantTenantID:    tenantID,
			wantCaseID:      &caseID,
			wantEmbedInput:  "policy",
			wantEmbedCalls:  1,
			wantStoreCalls:  1,
		},
		{
			name:         "caps large top k and returns paged result window",
			path:         "/v1/cases/" + caseID.String() + "/search?q=policy&top_k=999",
			tenantHeader: tenantID.String(),
			storeMock: &mockRAGSearchStore{
				results: largeResults,
			},
			embedder: &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{Embedding: []float64{0.3, 0.4}},
			},
			wantStatus:      http.StatusOK,
			wantResultCount: maxRAGTopK,
			wantTopK:        maxRAGTopK,
			wantTenantID:    tenantID,
			wantCaseID:      &caseID,
			wantEmbedInput:  "policy",
			wantEmbedCalls:  1,
			wantStoreCalls:  1,
		},
		{
			name:         "blank query rejected",
			path:         "/v1/cases/" + caseID.String() + "/search?q=%20%20%20",
			tenantHeader: tenantID.String(),
			storeMock:    &mockRAGSearchStore{},
			embedder: &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
			},
			wantStatus:     http.StatusBadRequest,
			wantError:      "q is required",
			wantEmbedCalls: 0,
			wantStoreCalls: 0,
		},
		{
			name:         "invalid top k rejected",
			path:         "/v1/cases/" + caseID.String() + "/search?q=policy&top_k=abc",
			tenantHeader: tenantID.String(),
			storeMock:    &mockRAGSearchStore{},
			embedder: &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
			},
			wantStatus:     http.StatusBadRequest,
			wantError:      "invalid top_k",
			wantEmbedCalls: 0,
			wantStoreCalls: 0,
		},
		{
			name:         "invalid case id rejected",
			path:         "/v1/cases/not-a-uuid/search?q=policy",
			tenantHeader: tenantID.String(),
			storeMock:    &mockRAGSearchStore{},
			embedder: &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
			},
			wantStatus:     http.StatusBadRequest,
			wantError:      "invalid case ID",
			wantEmbedCalls: 0,
			wantStoreCalls: 0,
		},
		{
			name:      "missing tenant rejected",
			path:      "/v1/cases/" + caseID.String() + "/search?q=policy",
			storeMock: &mockRAGSearchStore{},
			embedder: &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
			},
			wantStatus:     http.StatusBadRequest,
			wantError:      "missing X-Tenant-ID header",
			wantEmbedCalls: 0,
			wantStoreCalls: 0,
		},
		{
			name:         "invalid tenant rejected",
			path:         "/v1/cases/" + caseID.String() + "/search?q=policy",
			tenantHeader: "not-a-uuid",
			storeMock:    &mockRAGSearchStore{},
			embedder: &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
			},
			wantStatus:     http.StatusBadRequest,
			wantError:      "invalid X-Tenant-ID format",
			wantEmbedCalls: 0,
			wantStoreCalls: 0,
		},
		{
			name:           "embedding failure",
			path:           "/v1/cases/" + caseID.String() + "/search?q=policy",
			tenantHeader:   tenantID.String(),
			storeMock:      &mockRAGSearchStore{},
			embedder:       &mockRAGEmbedder{err: errors.New("gateway down")},
			wantStatus:     http.StatusBadGateway,
			wantError:      "failed to create query embedding",
			wantEmbedInput: "policy",
			wantEmbedCalls: 1,
			wantStoreCalls: 0,
		},
		{
			name:         "store failure",
			path:         "/v1/cases/" + caseID.String() + "/search?q=policy",
			tenantHeader: tenantID.String(),
			storeMock:    &mockRAGSearchStore{err: errors.New("db timeout")},
			embedder: &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
			},
			wantStatus:     http.StatusInternalServerError,
			wantError:      "failed to search documents",
			wantTopK:       defaultRAGTopK,
			wantTenantID:   tenantID,
			wantCaseID:     &caseID,
			wantEmbedInput: "policy",
			wantEmbedCalls: 1,
			wantStoreCalls: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var storeImpl store.ChunkEmbeddingStore
			if tt.storeMock != nil {
				storeImpl = tt.storeMock
			}
			var embedderImpl ragQueryEmbedder
			if tt.embedder != nil {
				embedderImpl = tt.embedder
			}
			handler := newRAGSearchHTTPHandler(storeImpl, embedderImpl)

			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			if tt.tenantHeader != "" {
				req.Header.Set("X-Tenant-ID", tt.tenantHeader)
			}

			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantError != "" {
				if !strings.Contains(rec.Body.String(), tt.wantError) {
					t.Fatalf("body = %q, want substring %q", rec.Body.String(), tt.wantError)
				}
			} else {
				body := decodeRAGSearchResponse(t, rec)
				if len(body.Data) != tt.wantResultCount {
					t.Fatalf("len(data) = %d, want %d", len(body.Data), tt.wantResultCount)
				}
			}

			if tt.embedder != nil {
				if tt.embedder.callCount != tt.wantEmbedCalls {
					t.Fatalf("embedder calls = %d, want %d", tt.embedder.callCount, tt.wantEmbedCalls)
				}
				if tt.embedder.lastInput != tt.wantEmbedInput {
					t.Fatalf("embedder input = %q, want %q", tt.embedder.lastInput, tt.wantEmbedInput)
				}
			}
			if tt.storeMock != nil {
				if len(tt.storeMock.calls) != tt.wantStoreCalls {
					t.Fatalf("store calls = %d, want %d", len(tt.storeMock.calls), tt.wantStoreCalls)
				}
			}
			if tt.storeMock != nil && tt.wantStoreCalls == 1 {
				call := tt.storeMock.calls[0]
				if call.tenantID != tt.wantTenantID {
					t.Fatalf("tenantID = %v, want %v", call.tenantID, tt.wantTenantID)
				}
				if tt.wantCaseID != nil {
					if call.caseID == nil || *call.caseID != *tt.wantCaseID {
						t.Fatalf("caseID = %v, want %v", call.caseID, tt.wantCaseID)
					}
				}
				if call.topK != tt.wantTopK {
					t.Fatalf("topK = %d, want %d", call.topK, tt.wantTopK)
				}
				if tt.wantEmbedCalls > 0 && len(call.vector) == 0 {
					t.Fatal("expected embedding vector to be passed to store")
				}
			}
		})
	}
}

func TestRAGSearchHandlerSearchTenantIsolation(t *testing.T) {
	tenantA := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	tenantB := uuid.MustParse("ffffffff-1111-2222-3333-444444444444")
	caseID := uuid.New()

	storeMock := &mockRAGSearchStore{
		resultsByTenant: map[uuid.UUID][]store.RAGSearchResult{
			tenantA: []store.RAGSearchResult{{
				ChunkID:          uuid.New(),
				SourceDocumentID: uuid.New(),
				FileName:         "tenant-a.pdf",
				ChunkIndex:       0,
				Content:          "tenant-a result",
				MetadataJSON:     map[string]any{"tenant": "a"},
				SimilarityScore:  0.91,
			}},
			tenantB: []store.RAGSearchResult{{
				ChunkID:          uuid.New(),
				SourceDocumentID: uuid.New(),
				FileName:         "tenant-b.pdf",
				ChunkIndex:       0,
				Content:          "tenant-b result",
				MetadataJSON:     map[string]any{"tenant": "b"},
				SimilarityScore:  0.89,
			}},
		},
	}
	embedder := &mockRAGEmbedder{
		response: &llmclient.EmbeddingResponse{Embedding: []float64{0.1, 0.2}},
	}
	handler := newRAGSearchHTTPHandler(storeMock, embedder)

	tests := []struct {
		name         string
		tenantHeader string
		wantContent  string
		wantTenantID uuid.UUID
	}{
		{
			name:         "tenant a",
			tenantHeader: tenantA.String(),
			wantContent:  "tenant-a result",
			wantTenantID: tenantA,
		},
		{
			name:         "tenant b",
			tenantHeader: tenantB.String(),
			wantContent:  "tenant-b result",
			wantTenantID: tenantB,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Snapshot counts before this subtest to assert delta, not cumulative state
			embedCountBefore := embedder.callCount
			storeCountBefore := len(storeMock.calls)

			req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/search?q=policy", nil)
			req.Header.Set("X-Tenant-ID", tt.tenantHeader)

			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusOK, rec.Body.String())
			}

			body := decodeRAGSearchResponse(t, rec)
			if len(body.Data) != 1 {
				t.Fatalf("len(data) = %d, want 1", len(body.Data))
			}
			if body.Data[0].Content != tt.wantContent {
				t.Fatalf("content = %q, want %q", body.Data[0].Content, tt.wantContent)
			}

			// Assert exactly one embed and one store call per subtest (delta-based)
			if embedder.callCount-embedCountBefore != 1 {
				t.Fatalf("embedder calls delta = %d, want 1", embedder.callCount-embedCountBefore)
			}
			if len(storeMock.calls)-storeCountBefore != 1 {
				t.Fatalf("store calls delta = %d, want 1", len(storeMock.calls)-storeCountBefore)
			}
			lastCall := storeMock.calls[len(storeMock.calls)-1]
			if lastCall.tenantID != tt.wantTenantID {
				t.Fatalf("tenantID = %v, want %v", lastCall.tenantID, tt.wantTenantID)
			}
		})
	}
}
