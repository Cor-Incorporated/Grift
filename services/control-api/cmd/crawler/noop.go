package main

import (
	"context"

	"github.com/google/uuid"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/crawler"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
)

// noopInstallationLister returns an empty list. Replace with a real
// database-backed implementation in a future phase.
type noopInstallationLister struct{}

func (n *noopInstallationLister) ListActiveInstallations(_ context.Context) ([]crawler.TenantInstallation, error) {
	return nil, nil
}

// noopDiscoveryRunner returns no repositories. Replace with a real
// GitHub API-backed implementation in a future phase.
type noopDiscoveryRunner struct{}

func (n *noopDiscoveryRunner) DiscoverForTenant(_ context.Context, _ uuid.UUID, _ int64) ([]domain.Repository, error) {
	return nil, nil
}

// noopVelocityRunner returns nil. Replace with a real velocity
// analysis implementation in a future phase.
type noopVelocityRunner struct{}

func (n *noopVelocityRunner) AnalyzeRepository(_ context.Context, _ domain.Repository) (*domain.VelocityMetric, error) {
	return &domain.VelocityMetric{}, nil
}

// noopPublisher discards events. Replace with a real Pub/Sub
// publisher in a future phase.
type noopPublisher struct{}

func (n *noopPublisher) Publish(_ context.Context, _ string, _ any) error {
	return nil
}
