package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Cor-Incorporated/BenevolentDirector/services/control-api/internal/handler"
	"github.com/Cor-Incorporated/BenevolentDirector/services/control-api/internal/middleware"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handler.Healthz)

	// TODO(P1): Replace with AuthWithVerifier(firebaseVerifier) + TenantWithStore(sqlStore)
	// before staging deploy. Current stubs are for Phase 0 local dev only.
	var authMW, tenantMW func(http.Handler) http.Handler
	if os.Getenv("AUTH_DISABLED") == "true" {
		log.Println("WARNING: authentication disabled (AUTH_DISABLED=true)")
		authMW = middleware.Auth
		tenantMW = middleware.Tenant
	} else {
		authMW = middleware.Auth       // TODO(P1): middleware.AuthWithVerifier(verifier)
		tenantMW = middleware.Tenant   // TODO(P1): middleware.TenantWithStore(store)
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
