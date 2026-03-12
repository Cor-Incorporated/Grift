package storage

import (
	"context"
	"fmt"
	"io"
	"os"

	gcs "cloud.google.com/go/storage"
)

const sourceDocsBucketEnv = "GCS_BUCKET_SOURCE_DOCS"

// Uploader stores file contents by object path.
type Uploader interface {
	Upload(ctx context.Context, objectPath string, r io.Reader, contentType string) error
}

// GCSClient uploads objects to a single configured GCS bucket.
type GCSClient struct {
	client *gcs.Client
	bucket string
}

// NewGCSClient constructs a GCS uploader for the provided bucket.
func NewGCSClient(ctx context.Context, bucket string) (*GCSClient, error) {
	if bucket == "" {
		return nil, fmt.Errorf("bucket is required")
	}
	client, err := gcs.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("create gcs client: %w", err)
	}
	return &GCSClient{client: client, bucket: bucket}, nil
}

// NewGCSClientFromEnv creates a GCS uploader using GCS_BUCKET_SOURCE_DOCS.
func NewGCSClientFromEnv(ctx context.Context) (*GCSClient, error) {
	bucket := os.Getenv(sourceDocsBucketEnv)
	if bucket == "" {
		return nil, fmt.Errorf("%s is not set", sourceDocsBucketEnv)
	}
	return NewGCSClient(ctx, bucket)
}

// Upload writes an object to the configured bucket.
func (c *GCSClient) Upload(ctx context.Context, objectPath string, r io.Reader, contentType string) error {
	if c == nil || c.client == nil || c.bucket == "" {
		return fmt.Errorf("gcs client not configured")
	}
	if objectPath == "" {
		return fmt.Errorf("object path is required")
	}

	w := c.client.Bucket(c.bucket).Object(objectPath).NewWriter(ctx)
	if contentType != "" {
		w.ContentType = contentType
	}
	if _, err := io.Copy(w, r); err != nil {
		_ = w.Close()
		return fmt.Errorf("write object %s: %w", objectPath, err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("close object writer %s: %w", objectPath, err)
	}
	return nil
}
