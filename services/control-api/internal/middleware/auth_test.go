package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeTokenVerifier is a test double for TokenVerifier.
type fakeTokenVerifier struct {
	uid   string
	email string
	err   error
}

func (f *fakeTokenVerifier) VerifyIDToken(_ context.Context, _ string) (string, string, error) {
	return f.uid, f.email, f.err
}

func TestAuthWithVerifier_MissingAuthorizationHeader(t *testing.T) {
	verifier := &fakeTokenVerifier{uid: "uid-1", email: "test@example.com"}
	handler := AuthWithVerifier(verifier)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAuthWithVerifier_InvalidFormat(t *testing.T) {
	tests := []struct {
		name   string
		header string
	}{
		{"no bearer prefix", "some-token-value"},
		{"basic auth", "Basic dXNlcjpwYXNz"},
		{"empty bearer", "Bearer "},
		{"bearer only", "Bearer"},
	}

	verifier := &fakeTokenVerifier{uid: "uid-1", email: "test@example.com"}
	handler := AuthWithVerifier(verifier)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
			req.Header.Set("Authorization", tt.header)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestAuthWithVerifier_InvalidToken(t *testing.T) {
	verifier := &fakeTokenVerifier{err: fmt.Errorf("token expired")}
	handler := AuthWithVerifier(verifier)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("Authorization", "Bearer expired-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAuthWithVerifier_ValidToken(t *testing.T) {
	verifier := &fakeTokenVerifier{uid: "firebase-uid-123", email: "user@example.com"}

	var gotUID, gotEmail string
	handler := AuthWithVerifier(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUID = UserIDFromContext(r.Context())
		gotEmail = UserEmailFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if gotUID != "firebase-uid-123" {
		t.Errorf("UserIDFromContext() = %q, want %q", gotUID, "firebase-uid-123")
	}
	if gotEmail != "user@example.com" {
		t.Errorf("UserEmailFromContext() = %q, want %q", gotEmail, "user@example.com")
	}
}

func TestAuthWithVerifier_HealthzSkipsAuth(t *testing.T) {
	verifier := &fakeTokenVerifier{err: fmt.Errorf("should not be called")}
	handler := AuthWithVerifier(verifier)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestAuthWithVerifier_CaseInsensitiveBearer(t *testing.T) {
	verifier := &fakeTokenVerifier{uid: "uid-1", email: "test@example.com"}
	handler := AuthWithVerifier(verifier)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	req.Header.Set("Authorization", "bearer valid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestUserIDFromContext_EmptyContext(t *testing.T) {
	ctx := context.Background()
	if got := UserIDFromContext(ctx); got != "" {
		t.Errorf("UserIDFromContext() = %q, want empty string", got)
	}
}

func TestUserEmailFromContext_EmptyContext(t *testing.T) {
	ctx := context.Background()
	if got := UserEmailFromContext(ctx); got != "" {
		t.Errorf("UserEmailFromContext() = %q, want empty string", got)
	}
}

func TestAuthStub_PassesThrough(t *testing.T) {
	handler := Auth(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/cases", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}
