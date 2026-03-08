package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// EstimateMode determines how an estimate is calculated.
type EstimateMode string

const (
	// EstimateModeMarketComparison uses full market comparison with evidence.
	EstimateModeMarketComparison EstimateMode = "market_comparison"
	// EstimateModeHoursOnly provides hours breakdown without pricing.
	EstimateModeHoursOnly EstimateMode = "hours_only"
	// EstimateModeHybrid combines hours-based estimation with optional market comparison.
	EstimateModeHybrid EstimateMode = "hybrid"
)

// IsValid reports whether the estimate mode is a recognized value.
func (em EstimateMode) IsValid() bool {
	switch em {
	case EstimateModeMarketComparison, EstimateModeHoursOnly, EstimateModeHybrid:
		return true
	}
	return false
}

// EstimateStatus represents the review lifecycle of an estimate.
type EstimateStatus string

const (
	EstimateStatusDraft    EstimateStatus = "draft"
	EstimateStatusReady    EstimateStatus = "ready"
	EstimateStatusApproved EstimateStatus = "approved"
	EstimateStatusRejected EstimateStatus = "rejected"
)

// IsValid reports whether the estimate status is a recognized value.
func (es EstimateStatus) IsValid() bool {
	switch es {
	case EstimateStatusDraft, EstimateStatusReady, EstimateStatusApproved, EstimateStatusRejected:
		return true
	}
	return false
}

// Estimate represents a cost and hours estimation for a case.
type Estimate struct {
	ID                    uuid.UUID       `json:"id"`
	TenantID              uuid.UUID       `json:"tenant_id"`
	CaseID                uuid.UUID       `json:"case_id"`
	EstimateMode          EstimateMode    `json:"estimate_mode"`
	Status                EstimateStatus  `json:"status"`
	YourHourlyRate        float64         `json:"your_hourly_rate"`
	YourEstimatedHours    float64         `json:"your_estimated_hours"`
	TotalYourCost         float64         `json:"total_your_cost"`
	HoursInvestigation    *float64        `json:"hours_investigation,omitempty"`
	HoursImplementation   *float64        `json:"hours_implementation,omitempty"`
	HoursTesting          *float64        `json:"hours_testing,omitempty"`
	HoursBuffer           *float64        `json:"hours_buffer,omitempty"`
	HoursBreakdownReport  *string         `json:"hours_breakdown_report,omitempty"`
	MarketHourlyRate      *float64        `json:"market_hourly_rate,omitempty"`
	MarketEstimatedHours  *float64        `json:"market_estimated_hours,omitempty"`
	TotalMarketCost       *float64        `json:"total_market_cost,omitempty"`
	Multiplier            float64         `json:"multiplier"`
	AggregatedEvidenceID  *uuid.UUID      `json:"aggregated_evidence_id,omitempty"`
	PricingSnapshot       json.RawMessage `json:"pricing_snapshot,omitempty"`
	RiskFlags             []string        `json:"risk_flags"`
	CalibrationRatio      *float64        `json:"calibration_ratio,omitempty"`
	HistoricalCitations   json.RawMessage `json:"historical_citations,omitempty"`
	ThreeWayProposal      json.RawMessage `json:"three_way_proposal,omitempty"`
	GoNoGoResult          json.RawMessage `json:"go_no_go_result,omitempty"`
	ValueProposition      json.RawMessage `json:"value_proposition,omitempty"`
	CreatedAt             time.Time       `json:"created_at"`
	UpdatedAt             time.Time       `json:"updated_at"`
}
