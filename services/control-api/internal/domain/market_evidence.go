package domain

import (
	"time"

	"github.com/google/uuid"
)

// SourceAuthority classifies a citation source.
type SourceAuthority string

const (
	SourceAuthorityOfficial  SourceAuthority = "official"
	SourceAuthorityIndustry  SourceAuthority = "industry"
	SourceAuthorityCommunity SourceAuthority = "community"
	SourceAuthorityUnknown   SourceAuthority = "unknown"
)

// NumericRange represents an inclusive numeric range.
type NumericRange struct {
	Min *float64 `json:"min,omitempty"`
	Max *float64 `json:"max,omitempty"`
}

// MarketRange is kept as a semantic alias for market evidence payloads.
type MarketRange = NumericRange

// Citation is the API-facing citation model for market evidence.
type Citation struct {
	URL             string          `json:"url"`
	Title           string          `json:"title"`
	SourceAuthority SourceAuthority `json:"source_authority"`
	Snippet         string          `json:"snippet,omitempty"`
}

// EvidenceFragment represents a provider-specific evidence row.
type EvidenceFragment struct {
	ID                 uuid.UUID    `json:"id"`
	Provider           string       `json:"provider"`
	HourlyRateRange    *MarketRange `json:"hourly_rate_range,omitempty"`
	TotalHoursRange    *MarketRange `json:"total_hours_range,omitempty"`
	TeamSizeRange      *MarketRange `json:"team_size_range,omitempty"`
	DurationRange      *MarketRange `json:"duration_range,omitempty"`
	Citations          []Citation   `json:"citations"`
	ProviderConfidence float64      `json:"provider_confidence"`
	RetrievedAt        time.Time    `json:"retrieved_at"`
	RawResponse        string       `json:"-"`
}

// Contradiction captures a disagreement between providers.
type Contradiction struct {
	ProviderA   string `json:"provider_a"`
	ProviderB   string `json:"provider_b"`
	Field       string `json:"field"`
	Description string `json:"description"`
}

// AggregatedEvidence is the API response model for market evidence.
type AggregatedEvidence struct {
	ID                  uuid.UUID          `json:"id"`
	TenantID            uuid.UUID          `json:"-"`
	CaseID              *uuid.UUID         `json:"case_id,omitempty"`
	Fragments           []EvidenceFragment `json:"fragments"`
	ConsensusHoursRange *MarketRange       `json:"consensus_hours_range,omitempty"`
	ConsensusRateRange  *MarketRange       `json:"consensus_rate_range,omitempty"`
	OverallConfidence   string             `json:"overall_confidence"`
	Contradictions      []Contradiction    `json:"contradictions"`
	RequiresHumanReview bool               `json:"requires_human_review"`
	AggregatedAt        time.Time          `json:"aggregated_at"`
}
