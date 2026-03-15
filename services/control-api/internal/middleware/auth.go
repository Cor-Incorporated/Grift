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
	userRoleKey  contextKey = "user_role"
)

// TokenVerifier verifies Firebase ID tokens.
// Implementations must be safe for concurrent use.
type TokenVerifier interface {
	// VerifyIDToken verifies the provided ID token string and returns
	// the user ID, email, and role extracted from the token claims.
	VerifyIDToken(ctx context.Context, idToken string) (uid string, email string, role string, err error)
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

// UserRoleFromContext returns the authenticated user's role from the context.
func UserRoleFromContext(ctx context.Context) string {
	v, _ := ctx.Value(userRoleKey).(string)
	return v
}

// AuthWithVerifier creates an authentication middleware that verifies Firebase
// ID tokens from the Authorization header. The /health endpoint is excluded.
func AuthWithVerifier(verifier TokenVerifier) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/health" {
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

			uid, email, role, err := verifier.VerifyIDToken(r.Context(), idToken)
			if err != nil {
				log.Printf("auth: token verification failed: %v", err)
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), userIDKey, uid)
			ctx = context.WithValue(ctx, userEmailKey, email)
			ctx = context.WithValue(ctx, userRoleKey, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// Auth is a stub authentication middleware for local development (AUTH_DISABLED=true).
// It sets default admin credentials so RBAC checks pass in dev mode.
// Use AuthWithVerifier for production Firebase token verification.
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), userIDKey, "dev-user")
		ctx = context.WithValue(ctx, userEmailKey, "dev@localhost")
		ctx = context.WithValue(ctx, userRoleKey, "system_admin")
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
