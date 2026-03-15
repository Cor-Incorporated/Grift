package linear

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

const defaultGraphQLURL = "https://api.linear.app/graphql"

// Client executes Linear GraphQL mutations.
type Client struct {
	httpClient    *http.Client
	apiURL        string
	apiKey        string
	defaultTeamID string
}

// NewClient constructs a Linear GraphQL client.
func NewClient(apiKey, defaultTeamID string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		httpClient:    httpClient,
		apiURL:        defaultGraphQLURL,
		apiKey:        strings.TrimSpace(apiKey),
		defaultTeamID: strings.TrimSpace(defaultTeamID),
	}
}

// CreateProject creates a Linear project under the given team.
func (c *Client) CreateProject(ctx context.Context, teamID, name string) (*LinearProject, error) {
	resolvedTeamID, err := c.requireTeamID(teamID)
	if err != nil {
		return nil, err
	}
	var data struct {
		ProjectCreate struct {
			Success bool          `json:"success"`
			Project LinearProject `json:"project"`
		} `json:"projectCreate"`
	}
	variables := map[string]any{
		"input": map[string]any{
			"name":    name,
			"teamIds": []string{resolvedTeamID},
		},
	}
	if err := c.mutate(ctx, projectCreateMutation, variables, &data); err != nil {
		return nil, err
	}
	if !data.ProjectCreate.Success {
		return nil, fmt.Errorf("Linear projectCreate returned success=false")
	}
	return &data.ProjectCreate.Project, nil
}

// CreateCycle creates a Linear cycle under the given team.
// Linear requires teamId, startsAt, and endsAt for cycle creation.
func (c *Client) CreateCycle(ctx context.Context, teamID, name, startsAt, endsAt string) (*LinearCycle, error) {
	resolvedTeamID, err := c.requireTeamID(teamID)
	if err != nil {
		return nil, err
	}
	var data struct {
		CycleCreate struct {
			Success bool        `json:"success"`
			Cycle   LinearCycle `json:"cycle"`
		} `json:"cycleCreate"`
	}
	variables := map[string]any{
		"input": map[string]any{
			"name":     name,
			"teamId":   resolvedTeamID,
			"startsAt": startsAt,
			"endsAt":   endsAt,
		},
	}
	if err := c.mutate(ctx, cycleCreateMutation, variables, &data); err != nil {
		return nil, err
	}
	if !data.CycleCreate.Success {
		return nil, fmt.Errorf("Linear cycleCreate returned success=false")
	}
	return &data.CycleCreate.Cycle, nil
}

// CreateIssue creates a Linear issue attached to a project.
func (c *Client) CreateIssue(ctx context.Context, teamID, projectID, title, description string) (*LinearIssue, error) {
	resolvedTeamID, err := c.requireTeamID(teamID)
	if err != nil {
		return nil, err
	}
	var data struct {
		IssueCreate struct {
			Success bool        `json:"success"`
			Issue   LinearIssue `json:"issue"`
		} `json:"issueCreate"`
	}
	variables := map[string]any{
		"input": map[string]any{
			"teamId":      resolvedTeamID,
			"projectId":   projectID,
			"title":       title,
			"description": description,
		},
	}
	if err := c.mutate(ctx, issueCreateMutation, variables, &data); err != nil {
		return nil, err
	}
	if !data.IssueCreate.Success {
		return nil, fmt.Errorf("Linear issueCreate returned success=false")
	}
	return &data.IssueCreate.Issue, nil
}

func (c *Client) resolveTeamID(teamID string) string {
	resolved := strings.TrimSpace(teamID)
	if resolved != "" {
		return resolved
	}
	return c.defaultTeamID
}

func (c *Client) requireTeamID(teamID string) (string, error) {
	resolved := c.resolveTeamID(teamID)
	if resolved == "" {
		return "", fmt.Errorf("linear team ID is required")
	}
	return resolved, nil
}

func (c *Client) mutate(ctx context.Context, query string, variables map[string]any, target any) error {
	if c == nil {
		return fmt.Errorf("linear client is not initialized")
	}
	if strings.TrimSpace(c.apiKey) == "" {
		return fmt.Errorf("linear api key is required")
	}

	body, err := json.Marshal(graphQLRequest{Query: query, Variables: variables})
	if err != nil {
		return fmt.Errorf("marshal Linear GraphQL request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create Linear GraphQL request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send Linear GraphQL request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("Linear GraphQL request failed with status %d", resp.StatusCode)
	}

	var envelope graphQLResponse
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("decode Linear GraphQL response: %w", err)
	}
	if len(envelope.Errors) > 0 {
		return fmt.Errorf("Linear GraphQL error: %s", joinGraphQLErrors(envelope.Errors))
	}
	if target == nil {
		return nil
	}
	if err := json.Unmarshal(envelope.Data, target); err != nil {
		return fmt.Errorf("decode Linear GraphQL payload: %w", err)
	}
	return nil
}

func joinGraphQLErrors(errors []graphQLError) string {
	messages := make([]string, 0, len(errors))
	for _, item := range errors {
		if item.Message == "" {
			continue
		}
		messages = append(messages, item.Message)
	}
	return strings.Join(messages, "; ")
}

type graphQLRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables,omitempty"`
}

type graphQLResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []graphQLError  `json:"errors"`
}

type graphQLError struct {
	Message string `json:"message"`
}

const projectCreateMutation = `
mutation ProjectCreate($input: ProjectCreateInput!) {
  projectCreate(input: $input) {
    success
    project {
      id
      name
      url
    }
  }
}`

const cycleCreateMutation = `
mutation CycleCreate($input: CycleCreateInput!) {
  cycleCreate(input: $input) {
    success
    cycle {
      id
      name
      url
    }
  }
}`

const issueCreateMutation = `
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      title
      url
    }
  }
}`
