package github

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// Client wraps an http.Client to automatically inject GitHub App installation
// token authentication headers into all requests.
type Client struct {
	httpClient    *http.Client
	tokenProvider TokenProvider
}

// NewClient creates a new Client that uses the given TokenProvider to
// authenticate requests with GitHub installation tokens.
func NewClient(tokenProvider TokenProvider) *Client {
	return &Client{
		httpClient:    &http.Client{Timeout: 30 * time.Second},
		tokenProvider: tokenProvider,
	}
}

// Do executes an HTTP request with the GitHub App installation token injected
// into the Authorization header. It also sets the Accept header to the GitHub
// API v3 media type.
func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
	token, err := c.tokenProvider.InstallationToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get installation token: %w", err)
	}

	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req.WithContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	return resp, nil
}
