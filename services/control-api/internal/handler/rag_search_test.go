package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/llmclient"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

type mockRAGSearchStore struct {
	results      []store.RAGSearchResult
	err          error
	lastTenantID uuid.UUID
	lastCaseID   *uuid.UUID
	lastTopK     int
	lastVector   []float64
}

func (m *mockRAGSearchStore) SearchSimilarChunks(_ context.Context, tenantID uuid.UUID, queryEmbedding any, topK int, caseID *uuid.UUID) ([]store.RAGSearchResult, error) {
	m.lastTenantID = tenantID
	m.lastTopK = topK
	m.lastCaseID = caseID
	switch values := queryEmbedding.(type) {
	case []float64:
		m.lastVector = append([]float64(nil), values...)
	}
	if m.err != nil {
		return nil, m.err
	}
	return m.results, nil
}

type mockRAGEmbedder struct {
	response  *llmclient.EmbeddingResponse
	err       error
	lastInput string
}

func (m *mockRAGEmbedder) Embed(_ context.Context, input string, _ llmclient.EmbeddingOptions) (*llmclient.EmbeddingResponse, error) {
	m.lastInput = input
	if m.err != nil {
		return nil, m.err
	}
	return m.response, nil
}

func withTenantForRAG(r *http.Request, tenantID string) *http.Request {
	r.Header.Set("X-Tenant-ID", tenantID)
	var captured *http.Request
	h := middleware.Tenant(http.HandlerFunc(func(_ http.ResponseWriter, req *http.Request) {
		captured = req
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if captured == nil {
		return r
	}
	return captured
}

func TestRAGSearchHandlerSearchSuccess(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	storeMock := &mockRAGSearchStore{
		results: []store.RAGSearchResult{
			{
				ChunkID:          uuid.New(),
				SourceDocumentID: uuid.New(),
				FileName:         "brief.pdf",
				ChunkIndex:       2,
				Content:          "matching chunk",
				MetadataJSON:     map[string]any{"source_document_id": uuid.New().String()},
				SimilarityScore:  0.92,
			},
		},
	}
	embedder := &mockRAGEmbedder{
		response: &llmclient.EmbeddingResponse{Model: "text-embedding-3-small", Embedding: []float64{0.1, 0.2, 0.3}},
	}

	h := NewRAGSearchHandler(storeMock, embedder)
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/search?q=need+invoice+rules&top_k=7", nil)
	req = withTenantForRAG(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if embedder.lastInput != "need invoice rules" {
		t.Fatalf("embedder input = %q, want %q", embedder.lastInput, "need invoice rules")
	}
	if storeMock.lastTenantID != tenantID {
		t.Fatalf("tenantID = %v, want %v", storeMock.lastTenantID, tenantID)
	}
	if storeMock.lastCaseID == nil || *storeMock.lastCaseID != caseID {
		t.Fatalf("caseID = %v, want %v", storeMock.lastCaseID, caseID)
	}
	if storeMock.lastTopK != 7 {
		t.Fatalf("topK = %d, want 7", storeMock.lastTopK)
	}
	if len(storeMock.lastVector) != 3 {
		t.Fatalf("embedding length = %d, want 3", len(storeMock.lastVector))
	}

	var body struct {
		Data []store.RAGSearchResult `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if len(body.Data) != 1 {
		t.Fatalf("len(data) = %d, want 1", len(body.Data))
	}
	if body.Data[0].Content != "matching chunk" {
		t.Fatalf("content = %q, want %q", body.Data[0].Content, "matching chunk")
	}
}

func TestRAGSearchHandlerSearchTopKDefaultAndCap(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	tests := []struct {
		name     string
		query    string
		wantTopK int
	}{
		{name: "default", query: "/v1/cases/" + caseID.String() + "/search?q=policy", wantTopK: defaultRAGTopK},
		{name: "cap", query: "/v1/cases/" + caseID.String() + "/search?q=policy&top_k=99", wantTopK: maxRAGTopK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			storeMock := &mockRAGSearchStore{}
			embedder := &mockRAGEmbedder{
				response: &llmclient.EmbeddingResponse{Embedding: []float64{0.5}},
			}
			h := NewRAGSearchHandler(storeMock, embedder)
			mux := http.NewServeMux()
			RegisterRAGSearchRoutes(mux, h)

			req := httptest.NewRequest(http.MethodGet, tt.query, nil)
			req = withTenantForRAG(req, tenantID.String())

			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusOK, rec.Body.String())
			}
			if storeMock.lastTopK != tt.wantTopK {
				t.Fatalf("topK = %d, want %d", storeMock.lastTopK, tt.wantTopK)
			}
		})
	}
}

func TestRAGSearchHandlerSearchInvalidTopK(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	h := NewRAGSearchHandler(&mockRAGSearchStore{}, &mockRAGEmbedder{
		response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
	})
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/search?q=policy&top_k=abc", nil)
	req = withTenantForRAG(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestRAGSearchHandlerSearchInvalidTenant(t *testing.T) {
	caseID := uuid.New()
	h := NewRAGSearchHandler(&mockRAGSearchStore{}, &mockRAGEmbedder{
		response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
	})
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/search?q=policy", nil)
	req.Header.Set("X-Tenant-ID", "not-a-uuid")

	rec := httptest.NewRecorder()
	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestRAGSearchHandlerSearchMissingTenant(t *testing.T) {
	caseID := uuid.New()
	h := NewRAGSearchHandler(&mockRAGSearchStore{}, &mockRAGEmbedder{
		response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
	})
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/search?q=policy", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestRAGSearchHandlerSearchBlankQuery(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	caseID := uuid.New()
	h := NewRAGSearchHandler(&mockRAGSearchStore{}, &mockRAGEmbedder{
		response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
	})
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/search?q=%20%20%20", nil)
	req = withTenantForRAG(req, tenantID)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestRAGSearchHandlerSearchInvalidCaseID(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	h := NewRAGSearchHandler(&mockRAGSearchStore{}, &mockRAGEmbedder{
		response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
	})
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/not-a-uuid/search?q=policy", nil)
	req = withTenantForRAG(req, tenantID)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestRAGSearchHandlerSearchEmbeddingFailure(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	h := NewRAGSearchHandler(&mockRAGSearchStore{}, &mockRAGEmbedder{err: errors.New("gateway down")})
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/search?q=policy", nil)
	req = withTenantForRAG(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusBadGateway, rec.Body.String())
	}
}

func TestRAGSearchHandlerSearchStoreFailure(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	h := NewRAGSearchHandler(&mockRAGSearchStore{err: errors.New("db timeout")}, &mockRAGEmbedder{
		response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
	})
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/search?q=policy", nil)
	req = withTenantForRAG(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
}

func TestRAGSearchHandlerSearchEmptyResult(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	h := NewRAGSearchHandler(&mockRAGSearchStore{}, &mockRAGEmbedder{
		response: &llmclient.EmbeddingResponse{Embedding: []float64{0.2}},
	})
	mux := http.NewServeMux()
	RegisterRAGSearchRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/search?q=policy", nil)
	req = withTenantForRAG(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body struct {
		Data []store.RAGSearchResult `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if len(body.Data) != 0 {
		t.Fatalf("len(data) = %d, want 0", len(body.Data))
	}
}
