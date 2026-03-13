package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

type mockCompletenessStore struct {
	getByCaseIDFn func(ctx context.Context, tenantID, caseID uuid.UUID) (*store.CompletenessObservation, error)
}

func (m *mockCompletenessStore) GetByCaseID(ctx context.Context, tenantID, caseID uuid.UUID) (*store.CompletenessObservation, error) {
	return m.getByCaseIDFn(ctx, tenantID, caseID)
}

func TestCompletenessHandlerGetByCaseID(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	caseID := uuid.New()

	tests := []struct {
		name       string
		tenant     string
		casePath   string
		store      *mockCompletenessStore
		wantStatus int
		wantError  string
	}{
		{
			name:       "missing tenant header",
			casePath:   caseID.String(),
			store:      &mockCompletenessStore{},
			wantStatus: http.StatusBadRequest,
			wantError:  "missing X-Tenant-ID header",
		},
		{
			name:       "invalid tenant header",
			tenant:     "bad-tenant",
			casePath:   caseID.String(),
			store:      &mockCompletenessStore{},
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid X-Tenant-ID format",
		},
		{
			name:       "invalid case id",
			tenant:     tenantID.String(),
			casePath:   "bad-case-id",
			store:      &mockCompletenessStore{},
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid case ID",
		},

		{
			name:     "not found",
			tenant:   tenantID.String(),
			casePath: caseID.String(),
			store: &mockCompletenessStore{
				getByCaseIDFn: func(_ context.Context, _, _ uuid.UUID) (*store.CompletenessObservation, error) {
					return nil, nil
				},
			},
			wantStatus: http.StatusNotFound,
			wantError:  "completeness observation not found",
		},
		{
			name:     "store error",
			tenant:   tenantID.String(),
			casePath: caseID.String(),
			store: &mockCompletenessStore{
				getByCaseIDFn: func(_ context.Context, _, _ uuid.UUID) (*store.CompletenessObservation, error) {
					return nil, errors.New("db timeout")
				},
			},
			wantStatus: http.StatusInternalServerError,
			wantError:  "internal server error",
		},
		{
			name:     "success",
			tenant:   tenantID.String(),
			casePath: caseID.String(),
			store: &mockCompletenessStore{
				getByCaseIDFn: func(_ context.Context, gotTenantID, gotCaseID uuid.UUID) (*store.CompletenessObservation, error) {
					if gotTenantID != tenantID {
						t.Fatalf("tenantID = %s, want %s", gotTenantID, tenantID)
					}
					if gotCaseID != caseID {
						t.Fatalf("caseID = %s, want %s", gotCaseID, caseID)
					}
					return &store.CompletenessObservation{
						OverallCompleteness: 0.6,
						Checklist: map[string]store.CompletenessChecklistItem{
							"budget": {
								Status:     "partial",
								Confidence: 0.5,
							},
						},
						SuggestedNextTopics: []string{"budget", "timeline"},
					}, nil
				},
			},
			wantStatus: http.StatusOK,
		},
	}

	t.Run("nil store panics", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("expected panic for nil store")
			}
		}()
		NewCompletenessHandler(nil)
	})

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewCompletenessHandler(tt.store)

			mux := http.NewServeMux()
			RegisterCompletenessRoutes(mux, h)

			req := httptest.NewRequest(
				http.MethodGet,
				"/v1/cases/"+tt.casePath+"/observation/completeness",
				nil,
			)
			if tt.tenant != "" {
				req.Header.Set("X-Tenant-ID", tt.tenant)
			}
			rec := httptest.NewRecorder()

			middleware.Tenant(mux).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantError != "" {
				var body map[string]string
				if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
					t.Fatalf("Decode() error = %v", err)
				}
				if body["error"] != tt.wantError {
					t.Fatalf("error = %q, want %q", body["error"], tt.wantError)
				}
				return
			}

			var body store.CompletenessObservation
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("Decode() error = %v", err)
			}
			if body.OverallCompleteness != 0.6 {
				t.Fatalf("OverallCompleteness = %v, want 0.6", body.OverallCompleteness)
			}
			if body.Checklist["budget"].Status != "partial" {
				t.Fatalf("Checklist[budget].Status = %q, want %q", body.Checklist["budget"].Status, "partial")
			}
			if len(body.SuggestedNextTopics) != 2 {
				t.Fatalf("len(SuggestedNextTopics) = %d, want 2", len(body.SuggestedNextTopics))
			}
		})
	}
}
