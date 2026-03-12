package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	sourcedocument "github.com/Cor-Incorporated/Grift/services/control-api/internal/source_document"
	"github.com/google/uuid"
)

type mockSourceDocumentStore struct {
	createErr    error
	listErr      error
	created      *domain.SourceDocument
	listItems    []domain.SourceDocument
	total        int
	lastTenantID uuid.UUID
	lastCaseID   uuid.UUID
	lastLimit    int
	lastOffset   int
}

func (m *mockSourceDocumentStore) Create(_ context.Context, doc *domain.SourceDocument) error {
	if m.createErr != nil {
		return m.createErr
	}
	copied := *doc
	m.created = &copied
	return nil
}

func (m *mockSourceDocumentStore) ListByCase(_ context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.SourceDocument, int, error) {
	m.lastTenantID = tenantID
	m.lastCaseID = caseID
	m.lastLimit = limit
	m.lastOffset = offset
	if m.listErr != nil {
		return nil, 0, m.listErr
	}
	return m.listItems, m.total, nil
}

var _ sourcedocument.Store = (*mockSourceDocumentStore)(nil)

type uploadCall struct {
	objectPath  string
	contentType string
	payload     string
}

type mockUploader struct {
	err   error
	calls []uploadCall
}

func (m *mockUploader) Upload(_ context.Context, objectPath string, r io.Reader, contentType string) error {
	if m.err != nil {
		return m.err
	}
	b, _ := io.ReadAll(r)
	m.calls = append(m.calls, uploadCall{
		objectPath:  objectPath,
		contentType: contentType,
		payload:     string(b),
	})
	return nil
}

func withTenantForSourceDocs(r *http.Request, tenantID string) *http.Request {
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

func multipartBody(t *testing.T, fieldName, fileName, content, sourceURL string) (*strings.Reader, string) {
	t.Helper()
	var b strings.Builder
	w := multipart.NewWriter(&b)
	if fileName != "" {
		fw, err := w.CreateFormFile(fieldName, fileName)
		if err != nil {
			t.Fatalf("CreateFormFile: %v", err)
		}
		if _, err := io.WriteString(fw, content); err != nil {
			t.Fatalf("write form file: %v", err)
		}
	}
	if sourceURL != "" {
		if err := w.WriteField("source_url", sourceURL); err != nil {
			t.Fatalf("WriteField: %v", err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("writer close: %v", err)
	}
	return strings.NewReader(b.String()), w.FormDataContentType()
}

func TestUploadSourceDocument_FileSuccess(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	store := &mockSourceDocumentStore{}
	uploader := &mockUploader{}
	h := NewSourceDocumentHandler(store, uploader)

	body, contentType := multipartBody(t, "file", "spec.pdf", "hello-pdf", "")

	mux := http.NewServeMux()
	RegisterSourceDocumentRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/source-documents", body)
	req.Header.Set("Content-Type", contentType)
	req = withTenantForSourceDocs(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusAccepted, rec.Body.String())
	}
	if store.created == nil {
		t.Fatal("expected store Create call")
	}
	if store.created.SourceKind != domain.SourceKindFileUpload {
		t.Fatalf("source_kind=%s want=%s", store.created.SourceKind, domain.SourceKindFileUpload)
	}
	if store.created.GCSPath == nil || *store.created.GCSPath == "" {
		t.Fatal("expected gcs_path set")
	}
	if len(uploader.calls) != 1 {
		t.Fatalf("upload calls=%d want=1", len(uploader.calls))
	}
	if uploader.calls[0].payload != "hello-pdf" {
		t.Fatalf("payload=%q want=%q", uploader.calls[0].payload, "hello-pdf")
	}
}

func TestUploadSourceDocument_SourceURLSuccess(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	store := &mockSourceDocumentStore{}
	h := NewSourceDocumentHandler(store, nil)

	body, contentType := multipartBody(t, "file", "", "", "https://github.com/Cor-Incorporated/Grift")
	mux := http.NewServeMux()
	RegisterSourceDocumentRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/source-documents", body)
	req.Header.Set("Content-Type", contentType)
	req = withTenantForSourceDocs(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusAccepted, rec.Body.String())
	}
	if store.created == nil {
		t.Fatal("expected store Create call")
	}
	if store.created.SourceKind != domain.SourceKindRepositoryURL {
		t.Fatalf("source_kind=%s want=%s", store.created.SourceKind, domain.SourceKindRepositoryURL)
	}
	if store.created.SourceURL == nil || *store.created.SourceURL == "" {
		t.Fatal("expected source_url")
	}
}

func TestUploadSourceDocument_MissingInput(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	store := &mockSourceDocumentStore{}
	h := NewSourceDocumentHandler(store, nil)

	body, contentType := multipartBody(t, "file", "", "", "")
	mux := http.NewServeMux()
	RegisterSourceDocumentRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/source-documents", body)
	req.Header.Set("Content-Type", contentType)
	req = withTenantForSourceDocs(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d", rec.Code, http.StatusBadRequest)
	}
}

func TestUploadSourceDocument_RequiresUploaderForFile(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	store := &mockSourceDocumentStore{}
	h := NewSourceDocumentHandler(store, nil)

	body, contentType := multipartBody(t, "file", "spec.zip", "zip-bytes", "")
	mux := http.NewServeMux()
	RegisterSourceDocumentRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/source-documents", body)
	req.Header.Set("Content-Type", contentType)
	req = withTenantForSourceDocs(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want=%d", rec.Code, http.StatusServiceUnavailable)
	}
}

func TestListSourceDocuments_SuccessAndTenantScope(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	now := time.Now().UTC().Truncate(time.Second)
	store := &mockSourceDocumentStore{
		listItems: []domain.SourceDocument{{
			ID:         uuid.New(),
			TenantID:   tenantID,
			CaseID:     caseID,
			FileName:   "doc1.pdf",
			SourceKind: domain.SourceKindFileUpload,
			Status:     domain.SourceDocumentStatusPending,
			CreatedAt:  now,
		}},
		total: 1,
	}
	h := NewSourceDocumentHandler(store, nil)

	mux := http.NewServeMux()
	RegisterSourceDocumentRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/source-documents?limit=5&offset=1", nil)
	req = withTenantForSourceDocs(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if store.lastTenantID != tenantID {
		t.Fatalf("tenant passed=%s want=%s", store.lastTenantID, tenantID)
	}
	if store.lastCaseID != caseID {
		t.Fatalf("case passed=%s want=%s", store.lastCaseID, caseID)
	}
	if store.lastLimit != 5 || store.lastOffset != 1 {
		t.Fatalf("pagination passed limit=%d offset=%d", store.lastLimit, store.lastOffset)
	}

	var resp struct {
		Data  []domain.SourceDocument `json:"data"`
		Total int                     `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if resp.Total != 1 || len(resp.Data) != 1 {
		t.Fatalf("response total=%d len=%d", resp.Total, len(resp.Data))
	}
}

func TestListSourceDocuments_NilStore(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	h := NewSourceDocumentHandler(nil, nil)

	mux := http.NewServeMux()
	RegisterSourceDocumentRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/source-documents", nil)
	req = withTenantForSourceDocs(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want=%d", rec.Code, http.StatusServiceUnavailable)
	}
}

func TestListSourceDocuments_MissingTenantContext(t *testing.T) {
	store := &mockSourceDocumentStore{}
	h := NewSourceDocumentHandler(store, nil)

	caseID := uuid.New()
	mux := http.NewServeMux()
	RegisterSourceDocumentRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+caseID.String()+"/source-documents", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d", rec.Code, http.StatusBadRequest)
	}
}

func TestUploadSourceDocument_InvalidSourceURL(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	store := &mockSourceDocumentStore{}
	h := NewSourceDocumentHandler(store, nil)

	body, contentType := multipartBody(t, "file", "", "", "://bad-url")
	mux := http.NewServeMux()
	RegisterSourceDocumentRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/source-documents", body)
	req.Header.Set("Content-Type", contentType)
	req = withTenantForSourceDocs(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestUploadSourceDocument_StoreError(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()
	store := &mockSourceDocumentStore{createErr: fmt.Errorf("db down")}
	h := NewSourceDocumentHandler(store, nil)

	body, contentType := multipartBody(t, "file", "", "", "https://example.com/spec")
	mux := http.NewServeMux()
	RegisterSourceDocumentRoutes(mux, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/cases/"+caseID.String()+"/source-documents", body)
	req.Header.Set("Content-Type", contentType)
	req = withTenantForSourceDocs(req, tenantID.String())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d want=%d", rec.Code, http.StatusInternalServerError)
	}
}
