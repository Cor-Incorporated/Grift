package handler

import (
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	sourcedocument "github.com/Cor-Incorporated/Grift/services/control-api/internal/source_document"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/storage"
	"github.com/google/uuid"
)

const sourceDocumentsMaxLimit = 100

// SourceDocumentHandler serves source document endpoints.
type SourceDocumentHandler struct {
	store    sourcedocument.Store
	uploader storage.Uploader
}

// NewSourceDocumentHandler creates a SourceDocumentHandler.
func NewSourceDocumentHandler(store sourcedocument.Store, uploader storage.Uploader) *SourceDocumentHandler {
	return &SourceDocumentHandler{store: store, uploader: uploader}
}

// RegisterSourceDocumentRoutes registers source document routes.
func RegisterSourceDocumentRoutes(mux *http.ServeMux, h *SourceDocumentHandler) {
	mux.HandleFunc("GET /v1/cases/{caseId}/source-documents", h.ListSourceDocuments)
	mux.HandleFunc("POST /v1/cases/{caseId}/source-documents", h.UploadSourceDocument)
}

// ListSourceDocuments handles GET /v1/cases/{caseId}/source-documents.
func (h *SourceDocumentHandler) ListSourceDocuments(w http.ResponseWriter, r *http.Request) {
	if h.store == nil {
		writeJSONError(w, "source document store not configured", http.StatusServiceUnavailable)
		return
	}

	tenantID, caseID, ok := parseTenantAndCaseIDs(w, r)
	if !ok {
		return
	}

	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			limit = v
		}
	}
	if limit > sourceDocumentsMaxLimit {
		limit = sourceDocumentsMaxLimit
	}

	offset := 0
	if raw := r.URL.Query().Get("offset"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v >= 0 {
			offset = v
		}
	}

	docs, total, err := h.store.ListByCase(r.Context(), tenantID, caseID, limit, offset)
	if err != nil {
		writeJSONError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": docs, "total": total})
}

// UploadSourceDocument handles POST /v1/cases/{caseId}/source-documents.
func (h *SourceDocumentHandler) UploadSourceDocument(w http.ResponseWriter, r *http.Request) {
	if h.store == nil {
		writeJSONError(w, "source document store not configured", http.StatusServiceUnavailable)
		return
	}

	tenantID, caseID, ok := parseTenantAndCaseIDs(w, r)
	if !ok {
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSONError(w, "invalid multipart form", http.StatusBadRequest)
		return
	}

	sourceURLRaw := strings.TrimSpace(r.FormValue("source_url"))
	file, fileHeader, fileErr := r.FormFile("file")
	if fileErr == nil {
		defer file.Close()
	}
	if sourceURLRaw == "" && fileErr != nil {
		writeJSONError(w, "file or source_url is required", http.StatusBadRequest)
		return
	}
	if fileErr != nil && !errors.Is(fileErr, http.ErrMissingFile) {
		writeJSONError(w, "invalid file upload", http.StatusBadRequest)
		return
	}

	doc := &domain.SourceDocument{
		ID:       uuid.New(),
		TenantID: tenantID,
		CaseID:   caseID,
		Status:   domain.SourceDocumentStatusPending,
	}

	if fileErr == nil {
		if h.uploader == nil {
			writeJSONError(w, "source document storage not configured", http.StatusServiceUnavailable)
			return
		}

		filename := filepath.Base(strings.TrimSpace(fileHeader.Filename))
		if filename == "" {
			writeJSONError(w, "file name is required", http.StatusBadRequest)
			return
		}

		contentType := fileHeader.Header.Get("Content-Type")
		if contentType == "" {
			contentType = mime.TypeByExtension(strings.ToLower(filepath.Ext(filename)))
		}

		gcsPath := fmt.Sprintf("%s/%s/%s/%s", tenantID, caseID, doc.ID, filename)
		if err := h.uploader.Upload(r.Context(), gcsPath, file, contentType); err != nil {
			writeJSONError(w, "failed to upload file", http.StatusInternalServerError)
			return
		}

		doc.FileName = filename
		doc.SourceKind = domain.SourceKindFileUpload
		if contentType != "" {
			doc.FileType = &contentType
		}
		size := fileHeader.Size
		doc.FileSize = &size
		doc.GCSPath = &gcsPath
	} else {
		u, err := url.Parse(sourceURLRaw)
		if err != nil || u.Scheme == "" || u.Host == "" {
			writeJSONError(w, "invalid source_url", http.StatusBadRequest)
			return
		}

		kind := classifySourceURL(u)
		doc.SourceKind = kind
		doc.SourceURL = &sourceURLRaw
		doc.FileName = sourceNameFromURL(u)
	}

	if err := h.store.Create(r.Context(), doc); err != nil {
		writeJSONError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"data":   doc,
		"job_id": uuid.New().String(),
	})
}

func parseTenantAndCaseIDs(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantIDStr := middleware.TenantIDFromContext(r.Context())
	if tenantIDStr == "" {
		writeJSONError(w, "missing tenant context", http.StatusBadRequest)
		return uuid.Nil, uuid.Nil, false
	}
	tenantID, err := uuid.Parse(tenantIDStr)
	if err != nil {
		writeJSONError(w, "invalid tenant ID", http.StatusBadRequest)
		return uuid.Nil, uuid.Nil, false
	}

	caseIDStr := r.PathValue("caseId")
	if caseIDStr == "" {
		writeJSONError(w, "missing caseId path parameter", http.StatusBadRequest)
		return uuid.Nil, uuid.Nil, false
	}
	caseID, err := uuid.Parse(caseIDStr)
	if err != nil {
		writeJSONError(w, "invalid caseId format", http.StatusBadRequest)
		return uuid.Nil, uuid.Nil, false
	}

	return tenantID, caseID, true
}

func classifySourceURL(u *url.URL) domain.SourceKind {
	host := strings.ToLower(u.Host)
	if strings.Contains(host, "github.com") || strings.Contains(host, "gitlab.com") || strings.Contains(host, "bitbucket.org") {
		return domain.SourceKindRepositoryURL
	}
	return domain.SourceKindWebsiteURL
}

func sourceNameFromURL(u *url.URL) string {
	name := strings.TrimSpace(filepath.Base(u.Path))
	if name == "" || name == "/" || name == "." {
		return u.Host
	}
	return name
}
