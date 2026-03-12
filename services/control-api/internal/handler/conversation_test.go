package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/llmclient"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

type mockConversationStoreForHandler struct {
	listTurnsFunc        func(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]store.ConversationTurn, int, error)
	insertTurnFunc       func(ctx context.Context, tenantID, caseID uuid.UUID, role, content string, metadata map[string]any) (*store.ConversationTurn, error)
	ensureCaseExistsFunc func(ctx context.Context, tenantID, caseID uuid.UUID) error
}

func (m *mockConversationStoreForHandler) ListTurns(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]store.ConversationTurn, int, error) {
	if m.listTurnsFunc != nil {
		return m.listTurnsFunc(ctx, tenantID, caseID, limit, offset)
	}
	return nil, 0, nil
}

func (m *mockConversationStoreForHandler) InsertTurn(ctx context.Context, tenantID, caseID uuid.UUID, role, content string, metadata map[string]any) (*store.ConversationTurn, error) {
	if m.insertTurnFunc != nil {
		return m.insertTurnFunc(ctx, tenantID, caseID, role, content, metadata)
	}
	return &store.ConversationTurn{
		ID:         uuid.New(),
		CaseID:     caseID,
		Role:       role,
		Content:    content,
		Metadata:   metadata,
		TurnNumber: 1,
	}, nil
}

func (m *mockConversationStoreForHandler) EnsureCaseExists(ctx context.Context, tenantID, caseID uuid.UUID) error {
	if m.ensureCaseExistsFunc != nil {
		return m.ensureCaseExistsFunc(ctx, tenantID, caseID)
	}
	return nil
}

type mockLLMClientForHandler struct {
	completeFunc func(ctx context.Context, messages []llmclient.Message, opts llmclient.CompletionOptions) (*llmclient.CompletionResponse, error)
}

func (m *mockLLMClientForHandler) Complete(ctx context.Context, messages []llmclient.Message, opts llmclient.CompletionOptions) (*llmclient.CompletionResponse, error) {
	if m.completeFunc != nil {
		return m.completeFunc(ctx, messages, opts)
	}
	return &llmclient.CompletionResponse{
		Content: "assistant reply",
		Model:   "stub-model",
	}, nil
}

func newTestConversationHandler(s store.ConversationStore, caseStore store.CaseStore, llm service.LLMClient) *ConversationHandler {
	svc := service.NewConversationService(s, caseStore, nil, llm)
	return NewConversationHandler(svc)
}

func TestConversationHandlerListConversations(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	var gotLimit, gotOffset int
	h := newTestConversationHandler(&mockConversationStoreForHandler{
		listTurnsFunc: func(_ context.Context, gotTenantID, gotCaseID uuid.UUID, limit, offset int) ([]store.ConversationTurn, int, error) {
			if gotTenantID != tenantID {
				t.Fatalf("tenantID=%s want=%s", gotTenantID, tenantID)
			}
			if gotCaseID != caseID {
				t.Fatalf("caseID=%s want=%s", gotCaseID, caseID)
			}
			gotLimit = limit
			gotOffset = offset
			return []store.ConversationTurn{{
				ID:         uuid.New(),
				CaseID:     caseID,
				Role:       "assistant",
				Content:    "hello",
				Metadata:   map[string]any{"source": "test"},
				TurnNumber: 1,
			}}, 1, nil
		},
	}, nil, nil)

	mux := http.NewServeMux()
	RegisterConversationRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/conversations?limit=5&offset=2", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if gotLimit != 5 || gotOffset != 2 {
		t.Fatalf("pagination=%d/%d want=5/2", gotLimit, gotOffset)
	}

	var body struct {
		Data  []store.ConversationTurn `json:"data"`
		Total int                      `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error=%v", err)
	}
	if len(body.Data) != 1 || body.Total != 1 {
		t.Fatalf("len(data)=%d total=%d", len(body.Data), body.Total)
	}
}

func TestConversationHandlerListConversations_StoreError(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	h := newTestConversationHandler(&mockConversationStoreForHandler{
		listTurnsFunc: func(context.Context, uuid.UUID, uuid.UUID, int, int) ([]store.ConversationTurn, int, error) {
			return nil, 0, errors.New("db down")
		},
	}, nil, nil)

	mux := http.NewServeMux()
	RegisterConversationRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/conversations", nil)
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d want=%d", rec.Code, http.StatusInternalServerError)
	}
}

func TestConversationHandlerListConversations_MissingTenant(t *testing.T) {
	caseID := uuid.New()
	h := newTestConversationHandler(&mockConversationStoreForHandler{}, nil, nil)

	mux := http.NewServeMux()
	RegisterConversationRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/conversations", nil)
	rec := httptest.NewRecorder()

	h.ListConversations(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d", rec.Code, http.StatusBadRequest)
	}
}

func TestConversationHandlerSendMessage_Success(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	var insertRoles []string
	h := newTestConversationHandler(&mockConversationStoreForHandler{
		listTurnsFunc: func(_ context.Context, _, _ uuid.UUID, limit, offset int) ([]store.ConversationTurn, int, error) {
			switch {
			case limit == 1 && offset == 0:
				return nil, 0, nil
			case limit == 10 && offset == 0:
				return []store.ConversationTurn{{
					ID:         uuid.New(),
					CaseID:     caseID,
					Role:       "user",
					Content:    "Need help",
					Metadata:   map[string]any{},
					TurnNumber: 1,
				}}, 1, nil
			default:
				t.Fatalf("unexpected list call limit=%d offset=%d", limit, offset)
				return nil, 0, nil
			}
		},
		insertTurnFunc: func(_ context.Context, _, _ uuid.UUID, role, content string, metadata map[string]any) (*store.ConversationTurn, error) {
			insertRoles = append(insertRoles, role)
			return &store.ConversationTurn{
				ID:         uuid.New(),
				CaseID:     caseID,
				Role:       role,
				Content:    content,
				Metadata:   metadata,
				TurnNumber: len(insertRoles),
			}, nil
		},
	}, &mockCaseStore{}, &mockLLMClientForHandler{
		completeFunc: func(_ context.Context, messages []llmclient.Message, opts llmclient.CompletionOptions) (*llmclient.CompletionResponse, error) {
			if len(messages) == 0 || messages[0].Role != "system" {
				t.Fatalf("messages=%v", messages)
			}
			if opts.Stream {
				t.Fatal("expected non-streaming request")
			}
			if opts.DataClassification != "restricted" {
				t.Fatalf("data classification=%q want=%q", opts.DataClassification, "restricted")
			}
			return &llmclient.CompletionResponse{
				Content:            "assistant reply",
				Model:              "stub-model",
				DataClassification: "restricted",
				FallbackUsed:       true,
			}, nil
		},
	})

	mux := http.NewServeMux()
	RegisterConversationRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/conversations",
		bytes.NewBufferString(`{"content":"Need help"}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	req.Header.Set("X-Data-Classification", "restricted")
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(insertRoles) != 2 || insertRoles[0] != "user" || insertRoles[1] != "assistant" {
		t.Fatalf("insert roles=%v want=[user assistant]", insertRoles)
	}

	var body struct {
		Data store.ConversationTurn `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error=%v", err)
	}
	if body.Data.Role != "assistant" || body.Data.Content != "assistant reply" {
		t.Fatalf("assistant turn=%+v", body.Data)
	}
}

func TestConversationHandlerSendMessage_Errors(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	tests := []struct {
		name       string
		body       string
		store      *mockConversationStoreForHandler
		llm        *mockLLMClientForHandler
		wantStatus int
		wantBody   string
	}{
		{
			name:       "invalid json",
			body:       `{`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "invalid JSON body",
		},
		{
			name:       "blank content",
			body:       `{"content":"   "}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "content is required",
		},
		{
			name: "service error",
			body: `{"content":"Need help"}`,
			store: &mockConversationStoreForHandler{
				ensureCaseExistsFunc: func(context.Context, uuid.UUID, uuid.UUID) error {
					return sql.ErrNoRows
				},
			},
			wantStatus: http.StatusInternalServerError,
			wantBody:   "case not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestConversationHandler(tt.store, &mockCaseStore{}, tt.llm)
			mux := http.NewServeMux()
			RegisterConversationRoutes(mux, h)

			req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/conversations", strings.NewReader(tt.body))
			req.Header.Set("X-Tenant-ID", tenantID.String())
			rec := httptest.NewRecorder()

			middleware.Tenant(mux).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Fatalf("body=%q want contains %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestConversationHandlerStreamConversation_Success(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	h := newTestConversationHandler(&mockConversationStoreForHandler{
		listTurnsFunc: func(_ context.Context, _, _ uuid.UUID, limit, offset int) ([]store.ConversationTurn, int, error) {
			switch {
			case limit == 1 && offset == 0:
				return nil, 0, nil
			case limit == 10 && offset == 0:
				return []store.ConversationTurn{{
					ID:         uuid.New(),
					CaseID:     caseID,
					Role:       "user",
					Content:    "Need help",
					Metadata:   map[string]any{},
					TurnNumber: 1,
				}}, 1, nil
			default:
				return nil, 0, nil
			}
		},
		insertTurnFunc: func(_ context.Context, _, _ uuid.UUID, role, content string, metadata map[string]any) (*store.ConversationTurn, error) {
			return &store.ConversationTurn{
				ID:         uuid.New(),
				CaseID:     caseID,
				Role:       role,
				Content:    content,
				Metadata:   metadata,
				TurnNumber: 2,
			}, nil
		},
	}, &mockCaseStore{}, &mockLLMClientForHandler{
		completeFunc: func(_ context.Context, _ []llmclient.Message, opts llmclient.CompletionOptions) (*llmclient.CompletionResponse, error) {
			if !opts.Stream {
				t.Fatal("expected streaming request")
			}
			if opts.OnChunk == nil {
				t.Fatal("expected OnChunk callback")
			}
			if err := opts.OnChunk(llmclient.Chunk{Type: "delta", Content: "hello"}); err != nil {
				return nil, err
			}
			if err := opts.OnChunk(llmclient.Chunk{Type: "done"}); err != nil {
				return nil, err
			}
			return &llmclient.CompletionResponse{
				Content: "assistant reply",
				Model:   "stub-model",
			}, nil
		},
	})

	mux := http.NewServeMux()
	RegisterConversationRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/conversations/stream",
		bytes.NewBufferString(`{"content":"Need help"}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/x-ndjson" {
		t.Fatalf("content-type=%q want=%q", got, "application/x-ndjson")
	}

	lines := strings.Split(strings.TrimSpace(rec.Body.String()), "\n")
	if len(lines) < 2 {
		t.Fatalf("expected streamed frames, body=%q", rec.Body.String())
	}
	var chunk llmclient.Chunk
	if err := json.Unmarshal([]byte(lines[0]), &chunk); err != nil {
		t.Fatalf("json.Unmarshal() error=%v", err)
	}
	if chunk.Type != "delta" || chunk.Content != "hello" {
		t.Fatalf("chunk=%+v", chunk)
	}
}

func TestConversationHandlerStreamConversation_ErrorFrame(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	h := newTestConversationHandler(&mockConversationStoreForHandler{
		listTurnsFunc: func(_ context.Context, _, _ uuid.UUID, limit, offset int) ([]store.ConversationTurn, int, error) {
			if limit == 1 {
				return nil, 0, nil
			}
			return []store.ConversationTurn{}, 0, nil
		},
		insertTurnFunc: func(_ context.Context, _, _ uuid.UUID, role, content string, metadata map[string]any) (*store.ConversationTurn, error) {
			return &store.ConversationTurn{
				ID:         uuid.New(),
				CaseID:     caseID,
				Role:       role,
				Content:    content,
				Metadata:   metadata,
				TurnNumber: 1,
			}, nil
		},
	}, &mockCaseStore{}, &mockLLMClientForHandler{
		completeFunc: func(context.Context, []llmclient.Message, llmclient.CompletionOptions) (*llmclient.CompletionResponse, error) {
			return nil, errors.New("gateway timeout")
		},
	})

	mux := http.NewServeMux()
	RegisterConversationRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/conversations/stream",
		bytes.NewBufferString(`{"content":"Need help"}`))
	req.Header.Set("X-Tenant-ID", tenantID.String())
	rec := httptest.NewRecorder()

	middleware.Tenant(mux).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"type":"error"`) || !strings.Contains(rec.Body.String(), "gateway timeout") {
		t.Fatalf("body=%q", rec.Body.String())
	}
}

func TestParsePagination(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/cases?limit=200&offset=-1", nil)
	limit, offset := parsePagination(req)
	if limit != 20 || offset != 0 {
		t.Fatalf("defaults=%d/%d want=20/0", limit, offset)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/cases?limit=50&offset=3", nil)
	limit, offset = parsePagination(req)
	if limit != 50 || offset != 3 {
		t.Fatalf("values=%d/%d want=50/3", limit, offset)
	}
}

func TestWriteStreamError(t *testing.T) {
	rec := httptest.NewRecorder()
	writeStreamError(rec, errWithStatus("stream failed", http.StatusTeapot))

	if got := rec.Header().Get("Content-Type"); got != "application/x-ndjson" {
		t.Fatalf("content-type=%q want=%q", got, "application/x-ndjson")
	}
	if !strings.Contains(rec.Body.String(), `"type":"error"`) || !strings.Contains(rec.Body.String(), "stream failed") {
		t.Fatalf("body=%q", rec.Body.String())
	}
}
