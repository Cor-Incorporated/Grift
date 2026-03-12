package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

// mockRequirementArtifactStore implements store.RequirementArtifactStore for tests.
type mockRequirementArtifactStore struct {
	result *domain.RequirementArtifact
	err    error
}

var _ store.RequirementArtifactStore = (*mockRequirementArtifactStore)(nil)

func (m *mockRequirementArtifactStore) GetLatestByCaseID(_ context.Context, _, _ uuid.UUID) (*domain.RequirementArtifact, error) {
	return m.result, m.err
}

func TestRequirementArtifactHandler_GetLatestByCaseID(t *testing.T) {
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	caseID := uuid.New()
	artifactID := uuid.New()
	now := time.Now().Truncate(time.Second)

	tests := []struct {
		name       string
		store      store.RequirementArtifactStore
		caseID     string
		tenantID   string
		wantStatus int
	}{
		{
			name: "artifact found",
			store: &mockRequirementArtifactStore{
				result: &domain.RequirementArtifact{
					ID:           artifactID,
					TenantID:     uuid.MustParse(tenantID),
					CaseID:       caseID,
					Version:      2,
					Markdown:     "# Requirements",
					SourceChunks: []uuid.UUID{},
					Status:       domain.ArtifactStatusDraft,
					CreatedAt:    now,
					UpdatedAt:    now,
				},
			},
			caseID:     caseID.String(),
			tenantID:   tenantID,
			wantStatus: http.StatusOK,
		},
		{
			name:       "artifact not found",
			store:      &mockRequirementArtifactStore{result: nil, err: nil},
			caseID:     caseID.String(),
			tenantID:   tenantID,
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "store error",
			store:      &mockRequirementArtifactStore{err: errors.New("db failure")},
			caseID:     caseID.String(),
			tenantID:   tenantID,
			wantStatus: http.StatusInternalServerError,
		},
		{
			name:       "nil store returns 503",
			store:      nil,
			caseID:     caseID.String(),
			tenantID:   tenantID,
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			name:       "invalid caseId returns 400",
			store:      &mockRequirementArtifactStore{},
			caseID:     "not-a-uuid",
			tenantID:   tenantID,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing tenant returns 400",
			store:      &mockRequirementArtifactStore{},
			caseID:     caseID.String(),
			tenantID:   "",
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewRequirementArtifactHandler(tt.store)
			mux := http.NewServeMux()
			mux.HandleFunc("GET /v1/cases/{caseId}/requirement-artifact", h.GetLatestByCaseID)

			req := httptest.NewRequest(http.MethodGet, "/v1/cases/"+tt.caseID+"/requirement-artifact", nil)

			if tt.tenantID != "" {
				req.Header.Set("X-Tenant-ID", tt.tenantID)
				// Apply tenant middleware to inject context value.
				var captured *http.Request
				mid := middleware.Tenant(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
					captured = r
				}))
				mid.ServeHTTP(httptest.NewRecorder(), req)
				if captured != nil {
					req = captured
					// Re-set URL for mux routing.
					req.URL = req.URL
					req.RequestURI = "/v1/cases/" + tt.caseID + "/requirement-artifact"
				}
			}

			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			// Verify JSON structure for success case.
			if tt.wantStatus == http.StatusOK {
				var resp map[string]json.RawMessage
				if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
					t.Fatalf("invalid JSON response: %v", err)
				}
				if _, ok := resp["data"]; !ok {
					t.Error("response missing 'data' field")
				}
			}
		})
	}
}
