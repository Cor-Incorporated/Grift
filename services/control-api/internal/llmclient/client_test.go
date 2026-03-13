package llmclient

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func newTestClient(fn roundTripFunc) *HTTPLLMClient {
	return NewHTTPLLMClient("http://llm-gateway.test", &http.Client{Transport: fn})
}

func newTestResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestHTTPLLMClientCompleteParsesNDJSON(t *testing.T) {
	client := newTestClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %q, want /v1/chat/completions", req.URL.Path)
		}
		return newTestResponse(http.StatusOK,
			`{"type":"content","content":"hello "}`+"\n"+
				`{"type":"content","content":"world"}`+"\n"+
				`{"type":"done","done":true,"event_type":"conversation.turn.completed"}`+"\n",
		), nil
	})

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
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{"model":"stub","choices":[{"message":{"content":"buffered"}}]}`), nil
	})

	resp, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if resp.Content != "buffered" {
		t.Fatalf("Content = %q, want %q", resp.Content, "buffered")
	}
}

func TestNewHTTPLLMClient_DefaultBaseURL(t *testing.T) {
	client := NewHTTPLLMClient("", nil)
	if client.baseURL != defaultBaseURL {
		t.Errorf("baseURL = %q, want %q", client.baseURL, defaultBaseURL)
	}
	if client.httpClient == nil {
		t.Error("httpClient should not be nil")
	}
}

func TestNewHTTPLLMClient_WhitespaceOnlyBaseURL(t *testing.T) {
	client := NewHTTPLLMClient("   ", nil)
	if client.baseURL != defaultBaseURL {
		t.Errorf("baseURL = %q, want %q", client.baseURL, defaultBaseURL)
	}
}

func TestNewHTTPLLMClient_TrailingSlashTrimmed(t *testing.T) {
	client := NewHTTPLLMClient("http://example.com/", nil)
	if client.baseURL != "http://example.com" {
		t.Errorf("baseURL = %q, want trailing slash trimmed", client.baseURL)
	}
}

func TestNewHTTPLLMClient_CustomHTTPClient(t *testing.T) {
	custom := &http.Client{}
	client := NewHTTPLLMClient("http://example.com", custom)
	if client.httpClient != custom {
		t.Error("expected custom httpClient to be used")
	}
}

func TestNewFromEnv(t *testing.T) {
	t.Setenv("LLM_GATEWAY_URL", "http://test-gateway:9090")
	client := NewFromEnv()
	if client.baseURL != "http://test-gateway:9090" {
		t.Errorf("baseURL = %q, want %q", client.baseURL, "http://test-gateway:9090")
	}
}

func TestNewFromEnv_EmptyEnv(t *testing.T) {
	t.Setenv("LLM_GATEWAY_URL", "")
	client := NewFromEnv()
	if client.baseURL != defaultBaseURL {
		t.Errorf("baseURL = %q, want default %q", client.baseURL, defaultBaseURL)
	}
}

func TestComplete_ServerError(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusInternalServerError, ""), nil
	})

	_, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{})
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestComplete_BadRequest(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusBadRequest, ""), nil
	})

	_, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{})
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
}

func TestComplete_ConnectionRefused(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return nil, errors.New("connection refused")
	})

	_, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{})
	if err == nil {
		t.Fatal("expected error for connection failure")
	}
}

func TestComplete_InvalidJSON_Buffered(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{invalid json`), nil
	})

	_, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{})
	if err == nil {
		t.Fatal("expected error for invalid JSON response")
	}
}

func TestComplete_InvalidNDJSON_Stream(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, "{not valid json\n"), nil
	})

	_, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{Stream: true})
	if err == nil {
		t.Fatal("expected error for invalid NDJSON chunk")
	}
}

func TestComplete_StreamWithOnChunkError(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{"type":"content","content":"hello"}`+"\n"), nil
	})

	_, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{
		Stream: true,
		OnChunk: func(Chunk) error {
			return errors.New("chunk handler error")
		},
	})
	if err == nil {
		t.Fatal("expected error from OnChunk callback")
	}
}

func TestComplete_StreamWithOnChunkSuccess(t *testing.T) {
	var chunks []Chunk
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{"type":"content","content":"hi","data_classification":"internal"}`+"\n"), nil
	})

	resp, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{
		Stream: true,
		OnChunk: func(chunk Chunk) error {
			chunks = append(chunks, chunk)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if len(chunks) != 1 {
		t.Errorf("OnChunk called %d times, want 1", len(chunks))
	}
	if resp.DataClassification != "internal" {
		t.Errorf("DataClassification = %q, want %q", resp.DataClassification, "internal")
	}
}

func TestComplete_StreamEmptyLines(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, "\n\n"+`{"type":"content","content":"data"}`+"\n   \n"), nil
	})

	resp, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{Stream: true})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if resp.Content != "data" {
		t.Errorf("Content = %q, want %q", resp.Content, "data")
	}
}

func TestComplete_BufferedEmptyChoices(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{"model":"stub","choices":[]}`), nil
	})

	resp, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if resp.Content != "" {
		t.Errorf("Content = %q, want empty", resp.Content)
	}
}

func TestComplete_BufferedWithFallback(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{"model":"fallback-model","choices":[{"message":{"content":"ok"}}],"fallback":{"used":true},"data_classification":"confidential"}`), nil
	})

	resp, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if !resp.FallbackUsed {
		t.Error("FallbackUsed = false, want true")
	}
	if resp.Model != "fallback-model" {
		t.Errorf("Model = %q, want %q", resp.Model, "fallback-model")
	}
	if resp.DataClassification != "confidential" {
		t.Errorf("DataClassification = %q, want %q", resp.DataClassification, "confidential")
	}
}

func TestComplete_WithDataClassificationHeader(t *testing.T) {
	var gotHeader string
	client := newTestClient(func(req *http.Request) (*http.Response, error) {
		gotHeader = req.Header.Get("X-Data-Classification")
		return newTestResponse(http.StatusOK, `{"model":"stub","choices":[{"message":{"content":"ok"}}]}`), nil
	})

	_, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{
		DataClassification: "internal",
	})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if gotHeader != "internal" {
		t.Errorf("X-Data-Classification header = %q, want %q", gotHeader, "internal")
	}
}

func TestComplete_WithCustomModelAndTemperature(t *testing.T) {
	var gotBody chatCompletionRequest
	client := newTestClient(func(req *http.Request) (*http.Response, error) {
		if err := json.NewDecoder(req.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		return newTestResponse(http.StatusOK, `{"model":"custom","choices":[{"message":{"content":"ok"}}]}`), nil
	})

	_, err := client.Complete(context.Background(), []Message{{Role: "user", Content: "hi"}}, CompletionOptions{
		Model:       "custom-model",
		Temperature: 0.9,
	})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if gotBody.Model != "custom-model" {
		t.Fatalf("model = %q, want %q", gotBody.Model, "custom-model")
	}
	if gotBody.Temperature != 0.9 {
		t.Fatalf("temperature = %v, want 0.9", gotBody.Temperature)
	}
}

func TestHTTPLLMClientEmbedParsesJSON(t *testing.T) {
	var (
		gotPath   string
		gotMethod string
		gotBody   embeddingRequest
	)

	client := newTestClient(func(req *http.Request) (*http.Response, error) {
		gotPath = req.URL.Path
		gotMethod = req.Method
		if err := json.NewDecoder(req.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		return newTestResponse(http.StatusOK, `{"model":"text-embedding-3-small","data":[{"index":0,"embedding":[0.1,0.2,0.3]}]}`), nil
	})

	resp, err := client.Embed(context.Background(), "hello world", EmbeddingOptions{})
	if err != nil {
		t.Fatalf("Embed() error = %v", err)
	}
	if gotPath != "/v1/embeddings" {
		t.Fatalf("path = %q, want %q", gotPath, "/v1/embeddings")
	}
	if gotMethod != http.MethodPost {
		t.Fatalf("method = %q, want %q", gotMethod, http.MethodPost)
	}
	if gotBody.Model != defaultEmbeddingModel {
		t.Fatalf("model = %q, want %q", gotBody.Model, defaultEmbeddingModel)
	}
	if gotBody.EncodingFormat != "float" {
		t.Fatalf("encoding_format = %q, want %q", gotBody.EncodingFormat, "float")
	}
	if len(gotBody.Input) != 1 || gotBody.Input[0] != "hello world" {
		t.Fatalf("input = %#v, want single input", gotBody.Input)
	}
	if resp.Model != defaultEmbeddingModel {
		t.Fatalf("response model = %q, want %q", resp.Model, defaultEmbeddingModel)
	}
	if len(resp.Embedding) != 3 {
		t.Fatalf("embedding length = %d, want 3", len(resp.Embedding))
	}
}

func TestHTTPLLMClientEmbedUsesCustomModel(t *testing.T) {
	var gotBody embeddingRequest
	client := newTestClient(func(req *http.Request) (*http.Response, error) {
		if err := json.NewDecoder(req.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		return newTestResponse(http.StatusOK, `{"model":"custom-embedding","data":[{"index":0,"embedding":[0.5]}]}`), nil
	})

	resp, err := client.Embed(context.Background(), "hi", EmbeddingOptions{Model: "custom-embedding"})
	if err != nil {
		t.Fatalf("Embed() error = %v", err)
	}
	if gotBody.Model != "custom-embedding" {
		t.Fatalf("model = %q, want %q", gotBody.Model, "custom-embedding")
	}
	if resp.Model != "custom-embedding" {
		t.Fatalf("response model = %q, want %q", resp.Model, "custom-embedding")
	}
}

func TestHTTPLLMClientEmbedReturnsServerError(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusBadGateway, ""), nil
	})

	_, err := client.Embed(context.Background(), "hi", EmbeddingOptions{})
	if err == nil || !strings.Contains(err.Error(), "status 502") {
		t.Fatalf("Embed() error = %v, want status 502", err)
	}
}

func TestHTTPLLMClientEmbedInvalidJSON(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{invalid json`), nil
	})

	_, err := client.Embed(context.Background(), "hi", EmbeddingOptions{})
	if err == nil || !strings.Contains(err.Error(), "decode embedding response") {
		t.Fatalf("Embed() error = %v, want decode error", err)
	}
}

func TestHTTPLLMClientEmbedMissingData(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{"model":"text-embedding-3-small","data":[]}`), nil
	})

	_, err := client.Embed(context.Background(), "hi", EmbeddingOptions{})
	if err == nil || !strings.Contains(err.Error(), "missing data") {
		t.Fatalf("Embed() error = %v, want missing data error", err)
	}
}

func TestHTTPLLMClientEmbedEmptyEmbedding(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{"model":"text-embedding-3-small","data":[{"index":0,"embedding":[]}]}`), nil
	})

	_, err := client.Embed(context.Background(), "hi", EmbeddingOptions{})
	if err == nil || !strings.Contains(err.Error(), "missing embedding") {
		t.Fatalf("Embed() error = %v, want missing embedding error", err)
	}
}

func TestHTTPLLMClientEmbedDimensionMismatch(t *testing.T) {
	client := newTestClient(func(_ *http.Request) (*http.Response, error) {
		return newTestResponse(http.StatusOK, `{"model":"text-embedding-3-small","data":[{"index":0,"embedding":[0.1,0.2]}]}`), nil
	})

	_, err := client.Embed(context.Background(), "hi", EmbeddingOptions{ExpectedDimensions: 3})
	if err == nil || !strings.Contains(err.Error(), "dimension mismatch") {
		t.Fatalf("Embed() error = %v, want dimension mismatch error", err)
	}
}
