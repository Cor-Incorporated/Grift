package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"cloud.google.com/go/pubsub/v2"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/conversation"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/github"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/handler"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/llmclient"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/lib/pq"
)

func main() {
	ctx := context.Background()
	db := openDatabase()
	defer db.Close()

	runMigrations()

	var pubsubClient *pubsub.Client
	if projectID := os.Getenv("PUBSUB_PROJECT_ID"); projectID != "" {
		client, err := pubsub.NewClient(ctx, projectID)
		if err != nil {
			log.Fatalf("create pubsub client: %v", err)
		}
		pubsubClient = client
		defer pubsubClient.Close()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handler.Healthz)

	repoHandler := handler.NewRepositoryHandler(&github.SQLRepositoryStore{DB: db})
	handler.RegisterRepositoryRoutes(mux, repoHandler)

	velocityHandler := handler.NewVelocityHandler(github.NewSQLVelocityStore(db))
	mux.HandleFunc("GET /v1/repositories/{repositoryId}/velocity", velocityHandler.GetRepositoryVelocity)

	// Source document routes (P3-01)
	// TODO(P3): inject real source_document SQL store and GCS uploader.
	sourceDocumentHandler := handler.NewSourceDocumentHandler(nil, nil)
	handler.RegisterSourceDocumentRoutes(mux, sourceDocumentHandler)

	caseHandler := handler.NewCaseHandler(db)
	handler.RegisterCaseRoutes(mux, caseHandler)

	llm := llmclient.NewHTTPLLMClient(os.Getenv("LLM_GATEWAY_URL"), nil)
	var publisher *conversation.Publisher
	if pubsubClient != nil {
		publisher = conversation.NewPublisher(
			conversation.NewPubSubPublisher(pubsubClient),
			os.Getenv("PUBSUB_TOPIC"),
		)
	}
	conversationHandler := handler.NewConversationHandler(db, publisher, llm)
	handler.RegisterConversationRoutes(mux, conversationHandler)

	var authMW, tenantMW func(http.Handler) http.Handler
	if os.Getenv("AUTH_DISABLED") == "true" {
		log.Println("WARNING: authentication disabled (AUTH_DISABLED=true)")
		authMW = middleware.Auth
		tenantMW = middleware.TenantWithStore(&middleware.SQLTenantStore{DB: db})
	} else {
		// TODO(wave1): wire AuthWithVerifier(firebaseVerifier) here.
		// Wave 0 uses stub auth for local development only.
		// DO NOT deploy to production without real auth.
		authMW = middleware.Auth
		tenantMW = middleware.TenantWithStore(&middleware.SQLTenantStore{DB: db})
	}

	stack := middleware.Chain(
		authMW,
		tenantMW,
	)

	srv := &http.Server{
		Addr:              ":8080",
		Handler:           stack(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("control-api listening on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("shutdown error: %v", err)
	}
	log.Println("server stopped")
}

func openDatabase() *sql.DB {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		log.Fatalf("ping database: %v", err)
	}
	return db
}

func runMigrations() {
	migrationPath, err := resolveMigrationPath()
	if err != nil {
		log.Fatalf("resolve migration path: %v", err)
	}

	migrator, err := migrate.New(migrationPath, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("create migrator: %v", err)
	}
	defer migrator.Close()

	if err := migrator.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		log.Fatalf("run migrations: %v", err)
	}
}

func resolveMigrationPath() (string, error) {
	candidates := []string{
		"migrations",
		"/migrations",
		filepath.Join("services", "control-api", "migrations"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			abs, err := filepath.Abs(candidate)
			if err != nil {
				return "", err
			}
			return "file://" + abs, nil
		}
	}
	return "", os.ErrNotExist
}
