package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/marketevent"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/store"
	"github.com/google/uuid"
)

// ErrPublisherUnavailable indicates the market publisher is not configured.
var ErrPublisherUnavailable = errors.New("market publisher unavailable")

// MarketEvidenceService handles queueing and retrieval of market evidence.
type MarketEvidenceService struct {
	store     store.MarketEvidenceStore
	publisher *marketevent.Publisher
}

// CollectMarketEvidenceInput is the input contract for queueing collection.
type CollectMarketEvidenceInput struct {
	TenantID   uuid.UUID
	EvidenceID uuid.UUID
	CaseID     *uuid.UUID
	CaseType   domain.CaseType
	Context    string
	Region     string
	Providers  []string
}

// NewMarketEvidenceService constructs a MarketEvidenceService.
func NewMarketEvidenceService(s store.MarketEvidenceStore, publisher *marketevent.Publisher) *MarketEvidenceService {
	return &MarketEvidenceService{store: s, publisher: publisher}
}

// QueueCollection validates input and publishes a collection request event.
func (s *MarketEvidenceService) QueueCollection(ctx context.Context, input CollectMarketEvidenceInput) error {
	if s.publisher == nil {
		return ErrPublisherUnavailable
	}
	if input.TenantID == uuid.Nil {
		return fmt.Errorf("tenant_id is required")
	}
	if input.EvidenceID == uuid.Nil {
		return fmt.Errorf("evidence_id is required")
	}
	if !input.CaseType.IsValid() {
		return fmt.Errorf("invalid case type: %s", input.CaseType)
	}
	contextText := strings.TrimSpace(input.Context)
	if contextText == "" {
		return fmt.Errorf("context is required")
	}
	if utf8.RuneCountInString(contextText) > 10000 {
		return fmt.Errorf("context must be 10000 characters or less")
	}

	providers := input.Providers
	if len(providers) == 0 {
		providers = []string{"grok", "brave", "perplexity", "gemini"}
	}
	for _, provider := range providers {
		if !isValidMarketProvider(provider) {
			return fmt.Errorf("invalid market provider: %s", provider)
		}
	}

	region := strings.TrimSpace(input.Region)
	if region == "" {
		region = "japan"
	}

	if err := s.publisher.PublishRequested(ctx, marketevent.PublishInput{
		TenantID:   input.TenantID,
		EvidenceID: input.EvidenceID,
		CaseID:     input.CaseID,
		CaseType:   string(input.CaseType),
		Context:    contextText,
		Region:     region,
		Providers:  providers,
	}); err != nil {
		return fmt.Errorf("publish market research request: %w", err)
	}
	return nil
}

// GetByID returns market evidence by tenant-scoped identifier.
func (s *MarketEvidenceService) GetByID(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error) {
	if s.store == nil {
		return nil, nil
	}
	record, err := s.store.GetByID(ctx, tenantID, evidenceID)
	if err != nil {
		return nil, fmt.Errorf("get market evidence: %w", err)
	}
	return record, nil
}

func isValidMarketProvider(provider string) bool {
	switch provider {
	case "grok", "brave", "perplexity", "gemini":
		return true
	default:
		return false
	}
}
