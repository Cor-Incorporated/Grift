package middleware

import (
	"net"
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

// clientIP extracts the real client IP, preferring X-Forwarded-For
// (set by GKE ingress / Cloud Run proxy) over RemoteAddr.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// X-Forwarded-For: client, proxy1, proxy2 — use leftmost
		if idx := len(xff); idx > 0 {
			for i := 0; i < len(xff); i++ {
				if xff[i] == ',' {
					return xff[:i]
				}
			}
			return xff
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// RateLimit returns a middleware that limits requests using a fixed-window
// counter keyed by client IP (with X-Tenant-ID as secondary discriminator).
func RateLimit(cfg RateLimitConfig) Middleware {
	var mu sync.Mutex
	visitors := make(map[string]*visitor)
	var lastSweep time.Time

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Use real client IP (X-Forwarded-For behind proxy)
			// with tenant ID for per-tenant fairness.
			key := clientIP(r)
			if tid := r.Header.Get("X-Tenant-ID"); tid != "" {
				key = tid + ":" + key
			}

			mu.Lock()
			now := time.Now()

			// Periodic sweep: remove stale entries once per window to
			// prevent unbounded map growth.
			if now.Sub(lastSweep) >= cfg.Window {
				for k, v := range visitors {
					if now.Sub(v.lastReset) >= cfg.Window {
						delete(visitors, k)
					}
				}
				lastSweep = now
			}

			v, exists := visitors[key]
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
