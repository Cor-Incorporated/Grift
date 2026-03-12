package llmclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPLLMClientCompleteParsesNDJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = w.Write([]byte(`{"type":"content","content":"hello "}` + "\n"))
		_, _ = w.Write([]byte(`{"type":"content","content":"world"}` + "\n"))
		_, _ = w.Write([]byte(`{"type":"done","done":true,"event_type":"conversation.turn.completed"}` + "\n"))
	}))
	defer server.Close()

	client := NewHTTPLLMClient(server.URL, server.Client())
	resp, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{Stream: true})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	if resp.Content != "hello world" {
		t.Fatalf("Content = %q, want %q", resp.Content, "hello world")
	}
	if len(resp.Chunks) != 3 {
		t.Fatalf("len(Chunks) = %d, want 3", len(resp.Chunks))
	}
}

func TestHTTPLLMClientCompleteParsesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"stub","choices":[{"message":{"content":"buffered"}}]}`))
	}))
	defer server.Close()

	client := NewHTTPLLMClient(server.URL, server.Client())
	resp, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	if resp.Content != "buffered" {
		t.Fatalf("Content = %q, want %q", resp.Content, "buffered")
	}
}
