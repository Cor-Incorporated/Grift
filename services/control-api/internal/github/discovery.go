package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

const (
	discoveryBaseURL = "https://api.github.com"
	maxPerPage       = 100
	// maxPages is a safety cap to prevent infinite pagination loops.
	maxPages = 50
	// maxDiscoveryResponseBody caps the size of a single API response to 10 MiB.
	maxDiscoveryResponseBody = 10 * 1024 * 1024
)

// GitHubRepo represents a repository as returned by the GitHub API.
type GitHubRepo struct {
	ID       int64  `json:"id"`
	FullName string `json:"full_name"`
	Name     string `json:"name"`
	Owner    struct {
		Login string `json:"login"`
	} `json:"owner"`
	Description *string  `json:"description"`
	Language    *string  `json:"language"`
	StarCount   int      `json:"stargazers_count"`
	Topics      []string `json:"topics"`
	Private     bool     `json:"private"`
	Archived    bool     `json:"archived"`
}

// installationReposResponse is the envelope for GET /installation/repositories.
type installationReposResponse struct {
	TotalCount   int          `json:"total_count"`
	Repositories []GitHubRepo `json:"repositories"`
}

// DiscoveryOption configures a DiscoveryService.
type DiscoveryOption func(*DiscoveryService)

// WithDiscoveryBaseURL overrides the GitHub API base URL (useful for testing).
func WithDiscoveryBaseURL(u string) DiscoveryOption {
	return func(ds *DiscoveryService) {
		ds.baseURL = u
	}
}

// DiscoveryService discovers repositories accessible via a GitHub App installation.
type DiscoveryService struct {
	client  *Client
	baseURL string
}

// NewDiscoveryService creates a DiscoveryService with the given Client and options.
func NewDiscoveryService(client *Client, opts ...DiscoveryOption) *DiscoveryService {
	ds := &DiscoveryService{
		client:  client,
		baseURL: discoveryBaseURL,
	}
	for _, opt := range opts {
		opt(ds)
	}
	return ds
}

// ListAccessibleRepos returns all repositories accessible by the GitHub App
// installation. It handles pagination automatically (per_page=100).
func (ds *DiscoveryService) ListAccessibleRepos(ctx context.Context) ([]GitHubRepo, error) {
	var allRepos []GitHubRepo
	page := 1

	for {
		u, err := url.Parse(ds.baseURL + "/installation/repositories")
		if err != nil {
			return nil, fmt.Errorf("parsing installation repos URL: %w", err)
		}
		q := u.Query()
		q.Set("per_page", strconv.Itoa(maxPerPage))
		q.Set("page", strconv.Itoa(page))
		u.RawQuery = q.Encode()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, fmt.Errorf("creating installation repos request: %w", err)
		}

		resp, err := ds.client.Do(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("fetching installation repos page %d: %w", page, err)
		}

		repos, total, parseErr := ds.parseInstallationResponse(resp)
		if parseErr != nil {
			return nil, fmt.Errorf("parsing installation repos page %d: %w", page, parseErr)
		}

		allRepos = append(allRepos, repos...)

		if len(allRepos) >= total || len(repos) == 0 {
			break
		}
		page++
		if page > maxPages {
			break
		}
	}

	return allRepos, nil
}

// ListOrgRepos returns all repositories for the given organization.
// It handles pagination automatically (per_page=100).
func (ds *DiscoveryService) ListOrgRepos(ctx context.Context, org string) ([]GitHubRepo, error) {
	var allRepos []GitHubRepo
	page := 1

	for {
		u, err := url.Parse(ds.baseURL + "/orgs/" + url.PathEscape(org) + "/repos")
		if err != nil {
			return nil, fmt.Errorf("parsing org repos URL: %w", err)
		}
		q := u.Query()
		q.Set("per_page", strconv.Itoa(maxPerPage))
		q.Set("page", strconv.Itoa(page))
		u.RawQuery = q.Encode()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, fmt.Errorf("creating org repos request: %w", err)
		}

		resp, err := ds.client.Do(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("fetching org repos page %d: %w", page, err)
		}

		repos, parseErr := ds.parseOrgResponse(resp)
		if parseErr != nil {
			return nil, fmt.Errorf("parsing org repos page %d: %w", page, parseErr)
		}

		if len(repos) == 0 {
			break
		}

		allRepos = append(allRepos, repos...)

		if len(repos) < maxPerPage {
			break
		}
		page++
		if page > maxPages {
			break
		}
	}

	return allRepos, nil
}

// parseInstallationResponse reads and decodes the installation repos response.
func (ds *DiscoveryService) parseInstallationResponse(resp *http.Response) ([]GitHubRepo, int, error) {
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, 0, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDiscoveryResponseBody))
	if err != nil {
		return nil, 0, fmt.Errorf("reading response body: %w", err)
	}

	var result installationReposResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, 0, fmt.Errorf("decoding response: %w", err)
	}

	return result.Repositories, result.TotalCount, nil
}

// parseOrgResponse reads and decodes the org repos response.
func (ds *DiscoveryService) parseOrgResponse(resp *http.Response) ([]GitHubRepo, error) {
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDiscoveryResponseBody))
	if err != nil {
		return nil, fmt.Errorf("reading response body: %w", err)
	}

	var repos []GitHubRepo
	if err := json.Unmarshal(body, &repos); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	return repos, nil
}
