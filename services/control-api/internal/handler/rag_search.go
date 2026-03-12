package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/llmclient"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
)

const (
	defaultRAGTopK = 5
	maxRAGTopK     = 20
)

type ragQueryEmbedder interface {
	Embed(ctx context.Context, input string, opts llmclient.EmbeddingOptions) (*llmclient.EmbeddingResponse, error)
}

// RAGSearchHandler serves case-scoped document retrieval.
type RAGSearchHandler struct {
	store    store.ChunkEmbeddingStore
	embedder ragQueryEmbedder
}

// NewRAGSearchHandler creates a RAGSearchHandler.
func NewRAGSearchHandler(store store.ChunkEmbeddingStore, embedder ragQueryEmbedder) *RAGSearchHandler {
	return &RAGSearchHandler{store: store, embedder: embedder}
}

// RegisterRAGSearchRoutes registers case search routes with rate limiting.
func RegisterRAGSearchRoutes(mux *http.ServeMux, h *RAGSearchHandler) {
	rateLimited := middleware.RateLimit(middleware.RateLimitConfig{
		RequestsPerWindow: 30,
		Window:            time.Minute,
	})
	mux.Handle("GET /v1/cases/{caseId}/search", rateLimited(http.HandlerFunc(h.Search)))
}

// Search handles GET /v1/cases/{caseId}/search.
func (h *RAGSearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	if h.store == nil || h.embedder == nil {
		writeJSONError(w, "rag search not configured", http.StatusServiceUnavailable)
		return
	}

	tenantID, ok := parseTenantUUID(w, r)
	if !ok {
		return
	}
	caseID, ok := parseCaseUUID(w, r)
	if !ok {
		return
	}

	queryText := strings.TrimSpace(r.URL.Query().Get("q"))
	if queryText == "" {
		writeJSONError(w, "q is required", http.StatusBadRequest)
		return
	}

	topK, err := parseRAGTopK(r)
	if err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	embedding, err := h.embedder.Embed(r.Context(), queryText, llmclient.EmbeddingOptions{})
	if err != nil {
		writeJSONError(w, "failed to create query embedding", http.StatusBadGateway)
		return
	}

	results, err := h.store.SearchSimilarChunks(r.Context(), tenantID, embedding.Embedding, topK, &caseID)
	if err != nil {
		writeJSONError(w, "failed to search documents", http.StatusInternalServerError)
		return
	}
	if results == nil {
		results = []store.RAGSearchResult{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": results})
}

func parseRAGTopK(r *http.Request) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get("top_k"))
	if raw == "" {
		return defaultRAGTopK, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0, errWithStatus("invalid top_k", http.StatusBadRequest)
	}
	if value > maxRAGTopK {
		return maxRAGTopK, nil
	}
	return value, nil
}
