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
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/service"
	sourcedocument "github.com/Cor-Incorporated/Grift/services/control-api/internal/source_document"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/storage"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
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
	mux.HandleFunc("GET /health", handler.Health)

	repoHandler := handler.NewRepositoryHandler(&github.SQLRepositoryStore{DB: db})
	handler.RegisterRepositoryRoutes(mux, repoHandler)

	velocityHandler := handler.NewVelocityHandler(github.NewSQLVelocityStore(db))
	mux.HandleFunc("GET /v1/repositories/{repositoryId}/velocity", velocityHandler.GetRepositoryVelocity)

	// Source document routes (P3-01)
	sourceDocStore := &sourcedocument.SQLStore{DB: db}
	var gcsUploader storage.Uploader
	if bucket := os.Getenv("GCS_BUCKET_SOURCE_DOCS"); bucket != "" {
		client, err := storage.NewGCSClient(ctx, bucket)
		if err != nil {
			log.Fatalf("create GCS client: %v", err)
		}
		gcsUploader = client
		log.Printf("GCS uploader enabled (bucket: %s)", bucket)
	}
	sourceDocumentHandler := handler.NewSourceDocumentHandler(sourceDocStore, gcsUploader)
	handler.RegisterSourceDocumentRoutes(mux, sourceDocumentHandler)

	conversationStore := store.NewSQLConversationStore(db)
	caseStore := store.NewSQLCaseStore(db)
	caseService := service.NewCaseService(caseStore)
	caseHandler := handler.NewCaseHandler(caseService)
	handler.RegisterCaseRoutes(mux, caseHandler)

	tenantStore := store.NewSQLTenantStore(db)
	tenantService := service.NewTenantService(tenantStore)
	tenantHandler := handler.NewTenantHandler(tenantService)
	handler.RegisterTenantRoutes(mux, tenantHandler)

	llm := llmclient.NewHTTPLLMClient(os.Getenv("LLM_GATEWAY_URL"), nil)
	var publisher *conversation.Publisher
	if pubsubClient != nil {
		publisher = conversation.NewPublisher(
			conversation.NewPubSubPublisher(pubsubClient),
			os.Getenv("PUBSUB_TOPIC"),
		)
	}
	conversationService := service.NewConversationService(conversationStore, caseStore, publisher, llm)
	conversationHandler := handler.NewConversationHandler(conversationService)
	handler.RegisterConversationRoutes(mux, conversationHandler)

	ragSearchStore := store.NewSQLChunkEmbeddingStore(db)
	ragSearchHandler := handler.NewRAGSearchHandler(ragSearchStore, llm)
	handler.RegisterRAGSearchRoutes(mux, ragSearchHandler)

	// Requirement artifact route (P3: RequirementArtifact GET endpoint)
	reqArtifactStore := store.NewSQLRequirementArtifactStore(db)
	reqArtifactHandler := handler.NewRequirementArtifactHandler(reqArtifactStore)
	mux.HandleFunc("GET /v1/cases/{caseId}/requirement-artifact", reqArtifactHandler.GetLatestByCaseID)

	var authMW, tenantMW func(http.Handler) http.Handler
	if os.Getenv("AUTH_DISABLED") == "true" {
		log.Println("WARNING: authentication disabled (AUTH_DISABLED=true)")
		authMW = middleware.Auth
		tenantMW = middleware.TenantWithStore(&middleware.SQLTenantStore{DB: db})
	} else {
		firebaseProjectID := os.Getenv("FIREBASE_PROJECT_ID")
		if firebaseProjectID == "" {
			log.Fatal("FIREBASE_PROJECT_ID is required when AUTH_DISABLED is not set")
		}

		verifier, err := middleware.NewFirebaseVerifier(ctx, firebaseProjectID)
		if err != nil {
			log.Fatalf("initialize Firebase auth: %v", err)
		}
		log.Printf("Firebase auth enabled (project: %s)", firebaseProjectID)

		authMW = middleware.AuthWithVerifier(verifier)
		tenantMW = middleware.TenantWithStore(&middleware.SQLTenantStore{DB: db})
	}

	corsMW := middleware.CORS()

	stack := middleware.Chain(
		corsMW,
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
