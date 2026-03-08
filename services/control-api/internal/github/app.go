package github

import (
	"context"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v4"
)

const (
	// defaultTokenTTL is the cache TTL for installation tokens.
	defaultTokenTTL = 50 * time.Minute

	// jwtExpiry is the maximum lifetime of a GitHub App JWT (per GitHub spec).
	jwtExpiry = 10 * time.Minute

	// cacheKey is the key used to store the installation token in cache.
	cacheKey = "github:installation_token"
)

// AppConfig holds the configuration required to authenticate as a GitHub App.
type AppConfig struct {
	// AppID is the GitHub App's numeric identifier.
	AppID int64

	// PrivateKey is the RSA private key used to sign JWTs.
	PrivateKey *rsa.PrivateKey

	// InstallationID is the numeric ID of the GitHub App installation.
	InstallationID int64
}

// NewAppConfig reads GitHub App configuration from environment variables:
//   - GITHUB_APP_ID: the numeric app identifier
//   - GITHUB_APP_PRIVATE_KEY: the PEM-encoded RSA private key
//   - GITHUB_APP_INSTALLATION_ID: the numeric installation identifier
func NewAppConfig() (*AppConfig, error) {
	appIDStr := os.Getenv("GITHUB_APP_ID")
	if appIDStr == "" {
		return nil, fmt.Errorf("GITHUB_APP_ID is required")
	}

	appID, err := strconv.ParseInt(appIDStr, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("GITHUB_APP_ID must be a valid integer: %w", err)
	}

	privKeyPEM := os.Getenv("GITHUB_APP_PRIVATE_KEY")
	if privKeyPEM == "" {
		return nil, fmt.Errorf("GITHUB_APP_PRIVATE_KEY is required")
	}

	privKey, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(privKeyPEM))
	if err != nil {
		return nil, fmt.Errorf("failed to parse GITHUB_APP_PRIVATE_KEY: %w", err)
	}

	installIDStr := os.Getenv("GITHUB_APP_INSTALLATION_ID")
	if installIDStr == "" {
		return nil, fmt.Errorf("GITHUB_APP_INSTALLATION_ID is required")
	}

	installID, err := strconv.ParseInt(installIDStr, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("GITHUB_APP_INSTALLATION_ID must be a valid integer: %w", err)
	}

	return &AppConfig{
		AppID:          appID,
		PrivateKey:     privKey,
		InstallationID: installID,
	}, nil
}

// GenerateJWT creates a signed JWT for authenticating as the GitHub App.
// The token uses RS256 signing and has a 10-minute expiry per the GitHub spec.
// The now parameter allows callers to control the current time for testing.
func (c *AppConfig) GenerateJWT(now time.Time) (string, error) {
	claims := jwt.RegisteredClaims{
		Issuer:    strconv.FormatInt(c.AppID, 10),
		IssuedAt:  jwt.NewNumericDate(now.Add(-60 * time.Second)),
		ExpiresAt: jwt.NewNumericDate(now.Add(jwtExpiry)),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)

	signed, err := token.SignedString(c.PrivateKey)
	if err != nil {
		return "", fmt.Errorf("failed to sign JWT: %w", err)
	}

	return signed, nil
}

// TokenProvider provides GitHub installation access tokens.
// Implementations must be safe for concurrent use.
type TokenProvider interface {
	// InstallationToken returns a valid GitHub installation access token,
	// using a cached value when available.
	InstallationToken(ctx context.Context) (string, error)
}

// installationTokenResponse represents the GitHub API response for creating
// an installation access token.
type installationTokenResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// AppTokenProvider implements TokenProvider by generating GitHub App JWTs
// and exchanging them for installation access tokens via the GitHub API.
type AppTokenProvider struct {
	config     *AppConfig
	cache      TokenCache
	httpClient *http.Client
	baseURL    string
}

// AppTokenProviderOption configures an AppTokenProvider.
type AppTokenProviderOption func(*AppTokenProvider)

// WithHTTPClient sets the HTTP client used for GitHub API requests.
func WithHTTPClient(client *http.Client) AppTokenProviderOption {
	return func(p *AppTokenProvider) {
		p.httpClient = client
	}
}

// WithBaseURL sets the base URL for GitHub API requests (useful for testing).
func WithBaseURL(url string) AppTokenProviderOption {
	return func(p *AppTokenProvider) {
		p.baseURL = url
	}
}

// NewAppTokenProvider creates a new AppTokenProvider with the given config and cache.
func NewAppTokenProvider(config *AppConfig, cache TokenCache, opts ...AppTokenProviderOption) *AppTokenProvider {
	p := &AppTokenProvider{
		config:     config,
		cache:      cache,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		baseURL:    "https://api.github.com",
	}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

// InstallationToken returns a valid GitHub installation access token. It first
// checks the cache, and if no valid token is found, fetches a new one from the
// GitHub API and caches it for reuse.
func (p *AppTokenProvider) InstallationToken(ctx context.Context) (string, error) {
	cached, err := p.cache.Get(ctx, cacheKey)
	if err != nil {
		return "", fmt.Errorf("failed to read token cache: %w", err)
	}
	if cached != "" {
		return cached, nil
	}

	token, err := p.fetchInstallationToken(ctx)
	if err != nil {
		return "", err
	}

	if setErr := p.cache.Set(ctx, cacheKey, token, defaultTokenTTL); setErr != nil {
		// Log but don't fail — we have a valid token, just can't cache it.
		// In production this would use structured logging.
		_ = setErr
	}

	return token, nil
}

// fetchInstallationToken exchanges a GitHub App JWT for an installation token.
func (p *AppTokenProvider) fetchInstallationToken(ctx context.Context) (string, error) {
	jwtToken, err := p.config.GenerateJWT(time.Now())
	if err != nil {
		return "", fmt.Errorf("failed to generate JWT for token exchange: %w", err)
	}

	url := fmt.Sprintf("%s/app/installations/%d/access_tokens", p.baseURL, p.config.InstallationID)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create token request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to request installation token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp installationTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}

	if tokenResp.Token == "" {
		return "", fmt.Errorf("GitHub API returned empty token")
	}

	return tokenResp.Token, nil
}
