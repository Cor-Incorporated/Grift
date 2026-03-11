// Package main provides the standalone entrypoint for the repository crawl job.
// It reads configuration from environment variables, creates a crawler.Service
// with placeholder dependencies (real wiring in future phases), and runs a
// single crawl cycle with graceful SIGTERM handling.
package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/crawler"
)

func main() {
	cfg := crawler.DefaultConfig()

	if topic := os.Getenv("PUBSUB_TOPIC_VELOCITY"); topic != "" {
		cfg.EventTopic = topic
	}
	if v := os.Getenv("MAX_REPOS_PER_RUN"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			log.Fatalf("invalid MAX_REPOS_PER_RUN: %v", err)
		}
		cfg.MaxReposPerRun = n
	}
	if v := os.Getenv("MAX_RETRIES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			log.Fatalf("invalid MAX_RETRIES: %v", err)
		}
		cfg.MaxRetries = n
	}

	// TODO(P1): Wire real implementations once DB, GitHub client, and
	// Pub/Sub publisher are available. For now, use no-op placeholders
	// so the binary compiles and the orchestration logic can be validated.
	svc := crawler.NewService(
		&noopInstallationLister{},
		&noopDiscoveryRunner{},
		&noopVelocityRunner{},
		&noopPublisher{},
		cfg,
	)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	log.Printf("starting crawl job (max_repos=%d, max_retries=%d, topic=%s)",
		cfg.MaxReposPerRun, cfg.MaxRetries, cfg.EventTopic)

	result, err := svc.Run(ctx)
	if err != nil {
		log.Printf("crawl finished with error: %v", err)
		if result != nil {
			logResult(result)
		}
		os.Exit(1)
	}

	logResult(result)
	log.Println("crawl job completed successfully")
}

func logResult(result *crawler.CrawlResult) {
	data, err := json.Marshal(result)
	if err != nil {
		log.Printf("failed to marshal result: %v", err)
		return
	}
	log.Printf("crawl result: %s", data)
}
