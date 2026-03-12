package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// RateLimitConfig holds per-endpoint rate limiting parameters.
type RateLimitConfig struct {
	// RequestsPerWindow is the maximum number of requests allowed per window.
	RequestsPerWindow int
	// Window is the time window for rate limiting.
	Window time.Duration
}

type visitor struct {
	tokens    int
	lastReset time.Time
}

// RateLimit returns a middleware that limits requests using a fixed-window
// counter keyed by the X-Tenant-ID header (falls back to remote address).
func RateLimit(cfg RateLimitConfig) Middleware {
	var mu sync.Mutex
	visitors := make(map[string]*visitor)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get("X-Tenant-ID")
			if key == "" {
				key = r.RemoteAddr
			}

			mu.Lock()
			v, exists := visitors[key]
			now := time.Now()
			if !exists || now.Sub(v.lastReset) >= cfg.Window {
				v = &visitor{tokens: 0, lastReset: now}
				visitors[key] = v
			}
			v.tokens++
			current := v.tokens
			mu.Unlock()

			if current > cfg.RequestsPerWindow {
				retryAfter := cfg.Window.Seconds()
				w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter)))
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
