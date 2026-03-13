package llmclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	defaultBaseURL        = "http://localhost:8081"
	defaultModel          = "stub"
	defaultEmbeddingModel = "text-embedding-3-small"
	defaultTemperature    = 0.7
	defaultHTTPTimeout    = 30 * time.Second
	maxNDJSONScannerBytes = 1024 * 1024
)

// Message is the OpenAI-compatible chat message contract.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Chunk represents one NDJSON streaming chunk from llm-gateway.
type Chunk struct {
	Type               string `json:"type"`
	Content            string `json:"content,omitempty"`
	Error              string `json:"error,omitempty"`
	Done               bool   `json:"done,omitempty"`
	EventType          string `json:"event_type,omitempty"`
	DataClassification string `json:"data_classification,omitempty"`
}

// CompletionOptions controls request parameters for a completion request.
type CompletionOptions struct {
	Model              string
	Temperature        float64
	MaxTokens          *int
	Stream             bool
	DataClassification string
	OnChunk            func(Chunk) error
}

// CompletionResponse is the normalized llm-gateway response.
type CompletionResponse struct {
	Content            string
	Model              string
	FallbackUsed       bool
	DataClassification string
	Chunks             []Chunk
}

// EmbeddingOptions controls request parameters for an embeddings request.
type EmbeddingOptions struct {
	Model              string
	ExpectedDimensions int
}

// EmbeddingResponse is the normalized llm-gateway embedding response.
type EmbeddingResponse struct {
	Model     string
	Embedding []float64
}

// Client is the control-api abstraction for llm-gateway.
type Client interface {
	Complete(ctx context.Context, messages []Message, opts CompletionOptions) (*CompletionResponse, error)
}

// HTTPLLMClient calls llm-gateway over HTTP.
type HTTPLLMClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewHTTPLLMClient constructs a gateway client.
func NewHTTPLLMClient(baseURL string, httpClient *http.Client) *HTTPLLMClient {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = defaultBaseURL
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultHTTPTimeout}
	}
	return &HTTPLLMClient{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: httpClient,
	}
}

// NewFromEnv constructs a gateway client from LLM_GATEWAY_URL.
func NewFromEnv() *HTTPLLMClient {
	return NewHTTPLLMClient(os.Getenv("LLM_GATEWAY_URL"), nil)
}

// Complete calls POST /v1/chat/completions and normalizes the response.
func (c *HTTPLLMClient) Complete(ctx context.Context, messages []Message, opts CompletionOptions) (*CompletionResponse, error) {
	body, err := json.Marshal(chatCompletionRequest{
		Model:       firstNonEmpty(opts.Model, defaultModel),
		Messages:    messages,
		Temperature: nonZero(opts.Temperature, defaultTemperature),
		MaxTokens:   opts.MaxTokens,
		Stream:      opts.Stream,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal llm request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/v1/chat/completions",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("build llm request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if opts.DataClassification != "" {
		req.Header.Set("X-Data-Classification", opts.DataClassification)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call llm-gateway: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("llm-gateway status %d", resp.StatusCode)
	}

	if opts.Stream {
		return c.parseStream(resp, opts)
	}
	return c.parseBuffered(resp)
}

// Embed calls POST /v1/embeddings and normalizes the first embedding vector.
func (c *HTTPLLMClient) Embed(ctx context.Context, input string, opts EmbeddingOptions) (*EmbeddingResponse, error) {
	body, err := json.Marshal(embeddingRequest{
		Model:          firstNonEmpty(opts.Model, defaultEmbeddingModel),
		Input:          []string{input},
		EncodingFormat: "float",
	})
	if err != nil {
		return nil, fmt.Errorf("marshal embedding request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/v1/embeddings",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("build embedding request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call llm-gateway embeddings: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("llm-gateway embeddings status %d", resp.StatusCode)
	}

	var payload embeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode embedding response: %w", err)
	}
	if len(payload.Data) == 0 {
		return nil, fmt.Errorf("invalid embedding response: missing data")
	}
	if len(payload.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("invalid embedding response: missing embedding")
	}
	if opts.ExpectedDimensions > 0 && len(payload.Data[0].Embedding) != opts.ExpectedDimensions {
		return nil, fmt.Errorf(
			"embedding dimension mismatch: expected=%d got=%d",
			opts.ExpectedDimensions,
			len(payload.Data[0].Embedding),
		)
	}

	return &EmbeddingResponse{
		Model:     payload.Model,
		Embedding: payload.Data[0].Embedding,
	}, nil
}

func (c *HTTPLLMClient) parseBuffered(resp *http.Response) (*CompletionResponse, error) {
	var payload chatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode llm response: %w", err)
	}
	content := ""
	if len(payload.Choices) > 0 {
		content = payload.Choices[0].Message.Content
	}

	return &CompletionResponse{
		Content:            content,
		Model:              payload.Model,
		FallbackUsed:       payload.Fallback.Used,
		DataClassification: payload.DataClassification,
	}, nil
}

func (c *HTTPLLMClient) parseStream(resp *http.Response, opts CompletionOptions) (*CompletionResponse, error) {
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 16*1024), maxNDJSONScannerBytes)

	result := &CompletionResponse{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var chunk Chunk
		if err := json.Unmarshal([]byte(line), &chunk); err != nil {
			return nil, fmt.Errorf("decode ndjson chunk: %w", err)
		}
		result.Chunks = append(result.Chunks, chunk)
		if chunk.Type == "content" {
			result.Content += chunk.Content
		}
		if chunk.DataClassification != "" {
			result.DataClassification = chunk.DataClassification
		}
		if opts.OnChunk != nil {
			if err := opts.OnChunk(chunk); err != nil {
				return nil, fmt.Errorf("handle ndjson chunk: %w", err)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read ndjson stream: %w", err)
	}

	return result, nil
}

type chatCompletionRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float64   `json:"temperature"`
	MaxTokens   *int      `json:"max_tokens,omitempty"`
	Stream      bool      `json:"stream"`
}

type chatCompletionResponse struct {
	Model              string `json:"model"`
	DataClassification string `json:"data_classification"`
	Fallback           struct {
		Used bool `json:"used"`
	} `json:"fallback"`
	Choices []struct {
		Message Message `json:"message"`
	} `json:"choices"`
}

type embeddingRequest struct {
	Model          string   `json:"model"`
	Input          []string `json:"input"`
	EncodingFormat string   `json:"encoding_format"`
}

type embeddingResponse struct {
	Model string `json:"model"`
	Data  []struct {
		Embedding []float64 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func nonZero(value float64, fallback float64) float64 {
	if value == 0 {
		return fallback
	}
	return value
}
