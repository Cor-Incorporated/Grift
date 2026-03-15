package linear

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestClientCreateProjectUsesDefaultTeam(t *testing.T) {
	client := newTestClient(t, func(r *http.Request) *http.Response {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("Authorization = %q, want %q", got, "Bearer test-key")
		}
		req := decodeGraphQLRequest(t, r)
		input := req.Variables["input"].(map[string]any)
		teamIDs := input["teamIds"].([]any)
		if teamIDs[0] != "team-default" {
			t.Fatalf("teamIds[0] = %v, want %q", teamIDs[0], "team-default")
		}
		return jsonResponse(t, map[string]any{
			"data": map[string]any{
				"projectCreate": map[string]any{
					"success": true,
					"project": map[string]any{"id": "p1", "name": "Alpha", "url": "https://linear.app/project/p1"},
				},
			},
		})
	})

	project, err := client.CreateProject(context.Background(), "", "Alpha")
	if err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}
	if project.ID != "p1" {
		t.Fatalf("CreateProject() id = %q, want %q", project.ID, "p1")
	}
}

func TestClientCreateIssueUsesProvidedTeam(t *testing.T) {
	client := newTestClient(t, func(r *http.Request) *http.Response {
		req := decodeGraphQLRequest(t, r)
		input := req.Variables["input"].(map[string]any)
		if input["teamId"] != "team-explicit" {
			t.Fatalf("teamId = %v, want %q", input["teamId"], "team-explicit")
		}
		return jsonResponse(t, map[string]any{
			"data": map[string]any{
				"issueCreate": map[string]any{
					"success": true,
					"issue": map[string]any{
						"id": "i1", "identifier": "ENG-1", "title": "Ship handoff", "url": "https://linear.app/issue/i1",
					},
				},
			},
		})
	})

	issue, err := client.CreateIssue(context.Background(), "team-explicit", "project-1", "Ship handoff", "desc")
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}
	if issue.Identifier != "ENG-1" {
		t.Fatalf("CreateIssue() identifier = %q, want %q", issue.Identifier, "ENG-1")
	}
}

func TestClientCreateCycle(t *testing.T) {
	client := newTestClient(t, func(*http.Request) *http.Response {
		return jsonResponse(t, map[string]any{
			"data": map[string]any{
				"cycleCreate": map[string]any{
					"success": true,
					"cycle":   map[string]any{"id": "c1", "name": "Sprint 1", "url": "https://linear.app/cycle/c1"},
				},
			},
		})
	})

	cycle, err := client.CreateCycle(context.Background(), "", "Sprint 1", "2026-04-01", "2026-04-14")
	if err != nil {
		t.Fatalf("CreateCycle() error = %v", err)
	}
	if cycle.ID != "c1" {
		t.Fatalf("CreateCycle() id = %q, want %q", cycle.ID, "c1")
	}
}

func TestClientGraphQLError(t *testing.T) {
	client := newTestClient(t, func(*http.Request) *http.Response {
		return jsonResponse(t, map[string]any{
			"errors": []map[string]any{{"message": "team not found"}},
		})
	})

	_, err := client.CreateProject(context.Background(), "", "Alpha")
	if err == nil || err.Error() != "Linear GraphQL error: team not found" {
		t.Fatalf("CreateProject() error = %v", err)
	}
}

func TestClientRequiresTeamID(t *testing.T) {
	client := NewClient("test-key", "", &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("RoundTrip should not be called")
		return nil, nil
	})})

	_, err := client.CreateProject(context.Background(), "", "Alpha")
	if err == nil || err.Error() != "linear team ID is required" {
		t.Fatalf("CreateProject() error = %v", err)
	}
}

func newTestClient(t *testing.T, fn func(*http.Request) *http.Response) *Client {
	t.Helper()

	httpClient := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fn(r), nil
	})}
	client := NewClient("test-key", "team-default", httpClient)
	client.apiURL = "https://linear.test/graphql"
	return client
}

func decodeGraphQLRequest(t *testing.T, r *http.Request) graphQLRequest {
	t.Helper()

	var req graphQLRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	return req
}

func jsonResponse(t *testing.T, payload map[string]any) *http.Response {
	t.Helper()

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewReader(data)),
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}
