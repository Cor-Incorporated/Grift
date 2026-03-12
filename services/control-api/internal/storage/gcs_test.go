package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	gcs "cloud.google.com/go/storage"
	"google.golang.org/api/option"
)

func TestNewGCSClient(t *testing.T) {
	t.Setenv("STORAGE_EMULATOR_HOST", "http://127.0.0.1:1")

	tests := []struct {
		name    string
		bucket  string
		wantErr bool
	}{
		{
			name:    "bucket required",
			bucket:  "",
			wantErr: true,
		},
		{
			name:   "happy path",
			bucket: "source-docs",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, err := NewGCSClient(context.Background(), tt.bucket)
			if (err != nil) != tt.wantErr {
				t.Fatalf("NewGCSClient() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				if client == nil || client.client == nil || client.bucket != tt.bucket {
					t.Fatalf("NewGCSClient() = %+v", client)
				}
				_ = client.client.Close()
			}
		})
	}
}

func TestNewGCSClientFromEnv(t *testing.T) {
	t.Run("missing env", func(t *testing.T) {
		t.Setenv(sourceDocsBucketEnv, "")
		client, err := NewGCSClientFromEnv(context.Background())
		if err == nil {
			if client != nil && client.client != nil {
				_ = client.client.Close()
			}
			t.Fatal("NewGCSClientFromEnv() expected error")
		}
	})

	t.Run("uses env bucket", func(t *testing.T) {
		t.Setenv(sourceDocsBucketEnv, "documents")
		t.Setenv("STORAGE_EMULATOR_HOST", "http://127.0.0.1:1")
		client, err := NewGCSClientFromEnv(context.Background())
		if err != nil {
			t.Fatalf("NewGCSClientFromEnv() error = %v", err)
		}
		if client.bucket != "documents" {
			t.Fatalf("bucket = %q, want %q", client.bucket, "documents")
		}
		_ = client.client.Close()
	})
}

func TestGCSClient_Upload(t *testing.T) {
	t.Run("client not configured", func(t *testing.T) {
		err := (&GCSClient{}).Upload(context.Background(), "path/doc.txt", strings.NewReader("payload"), "text/plain")
		if err == nil {
			t.Fatal("Upload() expected error")
		}
	})

	t.Run("object path required", func(t *testing.T) {
		client := &GCSClient{client: mustTestStorageClient(t, roundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("unexpected request")
		})), bucket: "docs"}
		defer client.client.Close()

		err := client.Upload(context.Background(), "", strings.NewReader("payload"), "text/plain")
		if err == nil {
			t.Fatal("Upload() expected error")
		}
	})

	t.Run("copy error closes writer", func(t *testing.T) {
		var called bool
		client := &GCSClient{client: mustTestStorageClient(t, roundTripFunc(func(req *http.Request) (*http.Response, error) {
			called = true
			return jsonResponse(http.StatusOK, `{"name":"docs/test.txt"}`), nil
		})), bucket: "docs"}
		defer client.client.Close()

		err := client.Upload(context.Background(), "test.txt", errReader{err: errors.New("read failed")}, "text/plain")
		if err == nil || !strings.Contains(err.Error(), "write object test.txt") {
			t.Fatalf("Upload() error = %v", err)
		}
		if !called {
			t.Fatal("Upload() did not close writer after copy failure")
		}
	})

	t.Run("close error", func(t *testing.T) {
		client := &GCSClient{client: mustTestStorageClient(t, roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusInternalServerError, `{"error":"boom"}`), nil
		})), bucket: "docs"}
		defer client.client.Close()

		err := client.Upload(context.Background(), "dir/test.txt", strings.NewReader("payload"), "text/plain")
		if err == nil || !strings.Contains(err.Error(), "close object writer dir/test.txt") {
			t.Fatalf("Upload() error = %v", err)
		}
	})

	t.Run("happy path", func(t *testing.T) {
		var gotMethod, gotPath, gotContentType string
		var gotBody string
		client := &GCSClient{client: mustTestStorageClient(t, roundTripFunc(func(req *http.Request) (*http.Response, error) {
			body, err := io.ReadAll(req.Body)
			if err != nil {
				return nil, err
			}
			gotMethod = req.Method
			gotPath = req.URL.Path
			gotContentType = req.Header.Get("Content-Type")
			gotBody = string(body)
			return jsonResponse(http.StatusOK, `{"name":"docs/tenant/case/spec.txt"}`), nil
		})), bucket: "docs"}
		defer client.client.Close()

		err := client.Upload(context.Background(), "tenant/case/spec.txt", strings.NewReader("payload"), "text/plain")
		if err != nil {
			t.Fatalf("Upload() error = %v", err)
		}
		if gotMethod != http.MethodPost {
			t.Fatalf("method = %q, want POST", gotMethod)
		}
		if !strings.Contains(gotPath, "/upload/storage/v1/b/docs/o") {
			t.Fatalf("path = %q", gotPath)
		}
		if !strings.Contains(gotContentType, "multipart/related") {
			t.Fatalf("content-type = %q", gotContentType)
		}
		if !strings.Contains(gotBody, "payload") {
			t.Fatalf("body = %q", gotBody)
		}
	})
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type errReader struct {
	err error
}

func (r errReader) Read(_ []byte) (int, error) {
	return 0, r.err
}

func mustTestStorageClient(t *testing.T, rt http.RoundTripper) *gcs.Client {
	t.Helper()

	httpClient := &http.Client{Transport: rt}
	client, err := gcs.NewClient(
		context.Background(),
		option.WithHTTPClient(httpClient),
		option.WithoutAuthentication(),
	)
	if err != nil {
		t.Fatalf("gcs.NewClient() error = %v", err)
	}
	return client
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(bytes.NewBufferString(body)),
	}
}
