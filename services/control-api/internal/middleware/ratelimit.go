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
//
// Behind GKE ingress the proxy appends the real client IP as the
// rightmost entry, so we scan right-to-left and return the first
// non-private (routable) IP. If every entry is private or only one
// entry exists, we fall back to RemoteAddr.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := splitTrimCSV(xff)
		// Walk right-to-left: the proxy-appended (trustworthy) IP is last.
		for i := len(parts) - 1; i >= 0; i-- {
			ip := net.ParseIP(parts[i])
			if ip != nil && !isPrivateIP(ip) {
				return parts[i]
			}
		}
		// All entries are private — fall through to RemoteAddr.
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

// splitTrimCSV splits a comma-separated string and trims whitespace
// from each element.
func splitTrimCSV(s string) []string {
	var parts []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ',' {
			part := trimSpace(s[start:i])
			if part != "" {
				parts = append(parts, part)
			}
			start = i + 1
		}
	}
	return parts
}

// trimSpace trims leading and trailing ASCII spaces.
func trimSpace(s string) string {
	for len(s) > 0 && s[0] == ' ' {
		s = s[1:]
	}
	for len(s) > 0 && s[len(s)-1] == ' ' {
		s = s[:len(s)-1]
	}
	return s
}

// privateRanges is initialized once at package load to avoid
// rebuilding the CIDR slice on every isPrivateIP call.
var privateRanges = []*net.IPNet{
	parseCIDR("10.0.0.0/8"),
	parseCIDR("172.16.0.0/12"),
	parseCIDR("192.168.0.0/16"),
	parseCIDR("127.0.0.0/8"),
	parseCIDR("::1/128"),
	parseCIDR("fc00::/7"),
	parseCIDR("fe80::/10"),
}

// isPrivateIP reports whether ip is in a private / loopback / link-local range.
func isPrivateIP(ip net.IP) bool {
	for _, network := range privateRanges {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// parseCIDR is a helper that panics on invalid CIDR (called only with literals).
func parseCIDR(s string) *net.IPNet {
	_, network, err := net.ParseCIDR(s)
	if err != nil {
		panic("invalid CIDR: " + s)
	}
	return network
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
			resetAt := v.lastReset.Add(cfg.Window)
			mu.Unlock()

			if current > cfg.RequestsPerWindow {
				remaining := resetAt.Sub(now)
				retryAfter := max(int(remaining.Seconds())+1, 1) // round up, minimum 1s
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
