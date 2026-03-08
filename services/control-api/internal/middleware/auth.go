package middleware

import (
	"context"
	"log"
	"net/http"
	"strings"
)

const (
	userIDKey    contextKey = "user_id"
	userEmailKey contextKey = "user_email"
)

// TokenVerifier verifies Firebase ID tokens.
// Implementations must be safe for concurrent use.
type TokenVerifier interface {
	// VerifyIDToken verifies the provided ID token string and returns
	// the user ID and email extracted from the token claims.
	VerifyIDToken(ctx context.Context, idToken string) (uid string, email string, err error)
}

// UserIDFromContext returns the authenticated user's Firebase UID from the context.
func UserIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(userIDKey).(string)
	return v
}

// UserEmailFromContext returns the authenticated user's email from the context.
func UserEmailFromContext(ctx context.Context) string {
	v, _ := ctx.Value(userEmailKey).(string)
	return v
}

// AuthWithVerifier creates an authentication middleware that verifies Firebase
// ID tokens from the Authorization header. The /healthz endpoint is excluded.
func AuthWithVerifier(verifier TokenVerifier) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/healthz" {
				next.ServeHTTP(w, r)
				return
			}

			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"missing Authorization header"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				http.Error(w, `{"error":"invalid Authorization header format"}`, http.StatusUnauthorized)
				return
			}

			idToken := parts[1]
			if idToken == "" {
				http.Error(w, `{"error":"empty bearer token"}`, http.StatusUnauthorized)
				return
			}

			uid, email, err := verifier.VerifyIDToken(r.Context(), idToken)
			if err != nil {
				log.Printf("auth: token verification failed: %v", err)
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), userIDKey, uid)
			ctx = context.WithValue(ctx, userEmailKey, email)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// Auth is a stub authentication middleware that passes all requests through.
// Use AuthWithVerifier for production Firebase token verification.
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}
