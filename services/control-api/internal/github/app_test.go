package github

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
)

// testPrivateKey generates a test RSA private key for use in tests.
func testPrivateKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate test RSA key: %v", err)
	}
	return key
}

// testAppConfig creates an AppConfig with a test key for use in tests.
func testAppConfig(t *testing.T) *AppConfig {
	t.Helper()
	return &AppConfig{
		AppID:          12345,
		PrivateKey:     testPrivateKey(t),
		InstallationID: 67890,
	}
}

func TestGenerateJWT(t *testing.T) {
	tests := []struct {
		name       string
		appID      int64
		wantIssuer string
	}{
		{
			name:       "valid JWT with correct issuer",
			appID:      12345,
			wantIssuer: "12345",
		},
		{
			name:       "different app ID",
			appID:      99999,
			wantIssuer: "99999",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := testPrivateKey(t)
			config := &AppConfig{
				AppID:          tt.appID,
				PrivateKey:     key,
				InstallationID: 1,
			}

			now := time.Now().UTC()
			tokenStr, err := config.GenerateJWT(now)
			if err != nil {
				t.Fatalf("GenerateJWT() error = %v", err)
			}

			if tokenStr == "" {
				t.Fatal("GenerateJWT() returned empty string")
			}

			// Parse and verify the token
			parsed, err := jwt.ParseWithClaims(tokenStr, &jwt.RegisteredClaims{}, func(token *jwt.Token) (any, error) {
				if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
					t.Errorf("unexpected signing method: %v", token.Header["alg"])
				}
				return &key.PublicKey, nil
			})
			if err != nil {
				t.Fatalf("failed to parse JWT: %v", err)
			}

			claims, ok := parsed.Claims.(*jwt.RegisteredClaims)
			if !ok {
				t.Fatal("failed to extract claims")
			}

			if claims.Issuer != tt.wantIssuer {
				t.Errorf("Issuer = %q, want %q", claims.Issuer, tt.wantIssuer)
			}

			// IssuedAt should be 60 seconds before now (with 2s tolerance for test execution)
			wantIAT := now.Add(-60 * time.Second)
			iatDiff := claims.IssuedAt.Time.Sub(wantIAT).Abs()
			if iatDiff > 2*time.Second {
				t.Errorf("IssuedAt = %v, want ~%v (diff=%v)", claims.IssuedAt.Time, wantIAT, iatDiff)
			}

			// ExpiresAt should be 10 minutes after now (with 2s tolerance)
			wantExp := now.Add(10 * time.Minute)
			expDiff := claims.ExpiresAt.Time.Sub(wantExp).Abs()
			if expDiff > 2*time.Second {
				t.Errorf("ExpiresAt = %v, want ~%v (diff=%v)", claims.ExpiresAt.Time, wantExp, expDiff)
			}
		})
	}
}

func TestGenerateJWT_SigningMethod(t *testing.T) {
	config := testAppConfig(t)
	tokenStr, err := config.GenerateJWT(time.Now())
	if err != nil {
		t.Fatalf("GenerateJWT() error = %v", err)
	}

	// Parse without verification to check the header
	parser := jwt.NewParser(jwt.WithoutClaimsValidation())
	token, _, err := parser.ParseUnverified(tokenStr, &jwt.RegisteredClaims{})
	if err != nil {
		t.Fatalf("failed to parse token: %v", err)
	}

	alg, ok := token.Header["alg"].(string)
	if !ok || alg != "RS256" {
		t.Errorf("signing algorithm = %v, want RS256", token.Header["alg"])
	}
}

func TestInMemoryCache_GetSet(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
		ttl   time.Duration
		want  string
	}{
		{
			name:  "cache hit within TTL",
			key:   "token:1",
			value: "ghs_test_token",
			ttl:   time.Minute,
			want:  "ghs_test_token",
		},
		{
			name:  "cache miss for unknown key",
			key:   "token:unknown",
			value: "",
			ttl:   0,
			want:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cache := NewInMemoryCache()
			ctx := context.Background()

			if tt.value != "" {
				if err := cache.Set(ctx, tt.key, tt.value, tt.ttl); err != nil {
					t.Fatalf("Set() error = %v", err)
				}
			}

			got, err := cache.Get(ctx, tt.key)
			if err != nil {
				t.Fatalf("Get() error = %v", err)
			}

			if got != tt.want {
				t.Errorf("Get() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestInMemoryCache_Expiry(t *testing.T) {
	cache := NewInMemoryCache()
	ctx := context.Background()

	if err := cache.Set(ctx, "short-lived", "value", 50*time.Millisecond); err != nil {
		t.Fatalf("Set() error = %v", err)
	}

	// Verify it's present immediately
	got, err := cache.Get(ctx, "short-lived")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if got != "value" {
		t.Errorf("Get() before expiry = %q, want %q", got, "value")
	}

	// Wait for expiry
	time.Sleep(100 * time.Millisecond)

	got, err = cache.Get(ctx, "short-lived")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if got != "" {
		t.Errorf("Get() after expiry = %q, want empty string", got)
	}
}

func TestInMemoryCache_Overwrite(t *testing.T) {
	cache := NewInMemoryCache()
	ctx := context.Background()

	if err := cache.Set(ctx, "key", "value1", time.Minute); err != nil {
		t.Fatalf("Set() error = %v", err)
	}
	if err := cache.Set(ctx, "key", "value2", time.Minute); err != nil {
		t.Fatalf("Set() error = %v", err)
	}

	got, err := cache.Get(ctx, "key")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if got != "value2" {
		t.Errorf("Get() = %q, want %q", got, "value2")
	}
}

func TestAppTokenProvider_InstallationToken_CacheHit(t *testing.T) {
	cache := NewInMemoryCache()
	ctx := context.Background()

	// Pre-populate cache
	if err := cache.Set(ctx, cacheKey, "cached-token-123", time.Minute); err != nil {
		t.Fatalf("Set() error = %v", err)
	}

	config := testAppConfig(t)
	provider := NewAppTokenProvider(config, cache)

	got, err := provider.InstallationToken(ctx)
	if err != nil {
		t.Fatalf("InstallationToken() error = %v", err)
	}

	if got != "cached-token-123" {
		t.Errorf("InstallationToken() = %q, want %q", got, "cached-token-123")
	}
}

func TestAppTokenProvider_InstallationToken_CacheMiss(t *testing.T) {
	config := testAppConfig(t)

	// Set up a mock GitHub API server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify the request
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}

		expectedPath := "/app/installations/67890/access_tokens"
		if r.URL.Path != expectedPath {
			t.Errorf("path = %s, want %s", r.URL.Path, expectedPath)
		}

		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			t.Errorf("Authorization header = %q, want Bearer prefix", auth)
		}

		accept := r.Header.Get("Accept")
		if accept != "application/vnd.github+json" {
			t.Errorf("Accept header = %q, want application/vnd.github+json", accept)
		}

		w.WriteHeader(http.StatusCreated)
		resp := installationTokenResponse{
			Token:     "ghs_fresh_token_abc",
			ExpiresAt: time.Now().Add(time.Hour),
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			t.Errorf("failed to encode response: %v", err)
		}
	}))
	defer server.Close()

	cache := NewInMemoryCache()
	provider := NewAppTokenProvider(config, cache,
		WithBaseURL(server.URL),
		WithHTTPClient(server.Client()),
	)

	got, err := provider.InstallationToken(context.Background())
	if err != nil {
		t.Fatalf("InstallationToken() error = %v", err)
	}

	if got != "ghs_fresh_token_abc" {
		t.Errorf("InstallationToken() = %q, want %q", got, "ghs_fresh_token_abc")
	}

	// Verify the token was cached
	cached, err := cache.Get(context.Background(), cacheKey)
	if err != nil {
		t.Fatalf("cache.Get() error = %v", err)
	}
	if cached != "ghs_fresh_token_abc" {
		t.Errorf("cached token = %q, want %q", cached, "ghs_fresh_token_abc")
	}
}

func TestAppTokenProvider_InstallationToken_APIError(t *testing.T) {
	config := testAppConfig(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"Bad credentials"}`))
	}))
	defer server.Close()

	cache := NewInMemoryCache()
	provider := NewAppTokenProvider(config, cache,
		WithBaseURL(server.URL),
		WithHTTPClient(server.Client()),
	)

	_, err := provider.InstallationToken(context.Background())
	if err == nil {
		t.Fatal("InstallationToken() expected error for 401 response, got nil")
	}

	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error = %q, want to contain '401'", err.Error())
	}
}

func TestAppTokenProvider_InstallationToken_EmptyTokenResponse(t *testing.T) {
	config := testAppConfig(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(installationTokenResponse{Token: ""}); err != nil {
			t.Errorf("failed to encode response: %v", err)
		}
	}))
	defer server.Close()

	cache := NewInMemoryCache()
	provider := NewAppTokenProvider(config, cache,
		WithBaseURL(server.URL),
		WithHTTPClient(server.Client()),
	)

	_, err := provider.InstallationToken(context.Background())
	if err == nil {
		t.Fatal("InstallationToken() expected error for empty token, got nil")
	}

	if !strings.Contains(err.Error(), "empty token") {
		t.Errorf("error = %q, want to contain 'empty token'", err.Error())
	}
}

func TestAppTokenProvider_InstallationToken_UsesCache(t *testing.T) {
	config := testAppConfig(t)

	var callCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount.Add(1)
		w.WriteHeader(http.StatusCreated)
		resp := installationTokenResponse{
			Token:     "ghs_token_fresh",
			ExpiresAt: time.Now().Add(time.Hour),
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			t.Errorf("failed to encode response: %v", err)
		}
	}))
	defer server.Close()

	cache := NewInMemoryCache()
	provider := NewAppTokenProvider(config, cache,
		WithBaseURL(server.URL),
		WithHTTPClient(server.Client()),
	)

	ctx := context.Background()

	// First call — cache miss, fetches from API
	_, err := provider.InstallationToken(ctx)
	if err != nil {
		t.Fatalf("first InstallationToken() error = %v", err)
	}

	if c := callCount.Load(); c != 1 {
		t.Errorf("API call count = %d, want 1", c)
	}

	// Second call — should use cache
	_, err = provider.InstallationToken(ctx)
	if err != nil {
		t.Fatalf("second InstallationToken() error = %v", err)
	}

	if c := callCount.Load(); c != 1 {
		t.Errorf("API call count after cache hit = %d, want 1", c)
	}
}

func TestNewClient(t *testing.T) {
	provider := &fakeTokenProvider{token: "ghs_client_test"}
	client := NewClient(provider)

	if client == nil {
		t.Fatal("NewClient() returned nil")
	}
	if client.tokenProvider == nil {
		t.Error("NewClient().tokenProvider is nil")
	}
}

func TestClient_Do_SetsHeaders(t *testing.T) {
	provider := &fakeTokenProvider{token: "ghs_header_test"}
	client := NewClient(provider)

	var gotAuth, gotAccept string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotAccept = r.Header.Get("Accept")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL+"/repos/test", nil)
	if err != nil {
		t.Fatalf("NewRequest error = %v", err)
	}

	resp, err := client.Do(context.Background(), req)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	defer resp.Body.Close()

	if gotAuth != "token ghs_header_test" {
		t.Errorf("Authorization = %q, want %q", gotAuth, "token ghs_header_test")
	}

	if gotAccept != "application/vnd.github+json" {
		t.Errorf("Accept = %q, want %q", gotAccept, "application/vnd.github+json")
	}
}

func TestClient_Do_TokenProviderError(t *testing.T) {
	provider := &fakeTokenProvider{err: errors.New("token unavailable")}
	client := NewClient(provider)

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://api.github.com/repos/test", nil)
	if err != nil {
		t.Fatalf("NewRequest error = %v", err)
	}

	_, err = client.Do(context.Background(), req)
	if err == nil {
		t.Fatal("Do() expected error when token provider fails, got nil")
	}

	if !strings.Contains(err.Error(), "token unavailable") {
		t.Errorf("error = %q, want to contain 'token unavailable'", err.Error())
	}
}

// fakeTokenProvider is a test double for TokenProvider.
type fakeTokenProvider struct {
	token string
	err   error
}

func (f *fakeTokenProvider) InstallationToken(_ context.Context) (string, error) {
	return f.token, f.err
}
