package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// MarketEvidenceStore provides read access to aggregated market evidence.
type MarketEvidenceStore interface {
	GetByID(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error)
}

// SQLMarketEvidenceStore reads market evidence from PostgreSQL.
type SQLMarketEvidenceStore struct {
	db *sql.DB
}

// NewSQLMarketEvidenceStore creates a SQLMarketEvidenceStore backed by the given database.
func NewSQLMarketEvidenceStore(db *sql.DB) *SQLMarketEvidenceStore {
	if db == nil {
		panic("db must not be nil")
	}
	return &SQLMarketEvidenceStore{db: db}
}

// GetByID returns an aggregated evidence row and its fragments.
func (s *SQLMarketEvidenceStore) GetByID(ctx context.Context, tenantID, evidenceID uuid.UUID) (*domain.AggregatedEvidence, error) {
	const aggregateQuery = `
		SELECT id, case_id, fragment_ids,
			consensus_hours_min, consensus_hours_max,
			consensus_rate_min, consensus_rate_max,
			overall_confidence, contradictions,
			requires_human_review, aggregated_at
		FROM aggregated_evidences
		WHERE tenant_id = $1 AND id = $2
	`

	var (
		record              domain.AggregatedEvidence
		caseID              uuid.NullUUID
		fragmentIDs         []string
		consensusHoursMin   sql.NullFloat64
		consensusHoursMax   sql.NullFloat64
		consensusRateMin    sql.NullFloat64
		consensusRateMax    sql.NullFloat64
		contradictionsBytes []byte
	)

	err := executorFromContext(ctx, s.db).QueryRowContext(ctx, aggregateQuery, tenantID, evidenceID).Scan(
		&record.ID,
		&caseID,
		pq.Array(&fragmentIDs),
		&consensusHoursMin,
		&consensusHoursMax,
		&consensusRateMin,
		&consensusRateMax,
		&record.OverallConfidence,
		&contradictionsBytes,
		&record.RequiresHumanReview,
		&record.AggregatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get aggregated evidence: %w", err)
	}

	record.TenantID = tenantID
	if caseID.Valid {
		record.CaseID = &caseID.UUID
	}
	record.ConsensusHoursRange = numericRange(consensusHoursMin, consensusHoursMax)
	record.ConsensusRateRange = numericRange(consensusRateMin, consensusRateMax)
	if len(contradictionsBytes) > 0 {
		if err := json.Unmarshal(contradictionsBytes, &record.Contradictions); err != nil {
			return nil, fmt.Errorf("decode contradictions: %w", err)
		}
	}

	fragments, err := s.loadFragments(ctx, tenantID, fragmentIDs)
	if err != nil {
		return nil, err
	}
	record.Fragments = fragments

	return &record, nil
}

func (s *SQLMarketEvidenceStore) loadFragments(ctx context.Context, tenantID uuid.UUID, fragmentIDs []string) ([]domain.EvidenceFragment, error) {
	if len(fragmentIDs) == 0 {
		return []domain.EvidenceFragment{}, nil
	}

	const fragmentsQuery = `
		SELECT id, provider,
			hourly_rate_min, hourly_rate_max,
			total_hours_min, total_hours_max,
			team_size_min, team_size_max,
			duration_weeks_min, duration_weeks_max,
			citations, provider_confidence, retrieved_at
		FROM evidence_fragments
		WHERE tenant_id = $1 AND id = ANY($2::uuid[])
		ORDER BY array_position($2::uuid[], id)
	`

	rows, err := executorFromContext(ctx, s.db).QueryContext(ctx, fragmentsQuery, tenantID, pq.Array(fragmentIDs))
	if err != nil {
		return nil, fmt.Errorf("list evidence fragments: %w", err)
	}
	defer rows.Close()

	fragments := make([]domain.EvidenceFragment, 0, len(fragmentIDs))
	for rows.Next() {
		fragment, err := scanEvidenceFragment(rows)
		if err != nil {
			return nil, err
		}
		fragments = append(fragments, *fragment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate evidence fragments: %w", err)
	}

	return fragments, nil
}

func scanEvidenceFragment(scanner rowScanner) (*domain.EvidenceFragment, error) {
	var (
		record           domain.EvidenceFragment
		hourlyRateMin    sql.NullFloat64
		hourlyRateMax    sql.NullFloat64
		totalHoursMin    sql.NullFloat64
		totalHoursMax    sql.NullFloat64
		teamSizeMin      sql.NullInt64
		teamSizeMax      sql.NullInt64
		durationWeeksMin sql.NullInt64
		durationWeeksMax sql.NullInt64
		citationsBytes   []byte
	)

	if err := scanner.Scan(
		&record.ID,
		&record.Provider,
		&hourlyRateMin,
		&hourlyRateMax,
		&totalHoursMin,
		&totalHoursMax,
		&teamSizeMin,
		&teamSizeMax,
		&durationWeeksMin,
		&durationWeeksMax,
		&citationsBytes,
		&record.ProviderConfidence,
		&record.RetrievedAt,
	); err != nil {
		return nil, fmt.Errorf("scan evidence fragment: %w", err)
	}

	record.HourlyRateRange = numericRange(hourlyRateMin, hourlyRateMax)
	record.TotalHoursRange = numericRange(totalHoursMin, totalHoursMax)
	record.TeamSizeRange = intRange(teamSizeMin, teamSizeMax)
	record.DurationRange = intRange(durationWeeksMin, durationWeeksMax)
	record.Citations = []domain.Citation{}
	if len(citationsBytes) > 0 {
		if err := json.Unmarshal(citationsBytes, &record.Citations); err != nil {
			return nil, fmt.Errorf("decode citations: %w", err)
		}
	}

	return &record, nil
}

func numericRange(min, max sql.NullFloat64) *domain.MarketRange {
	if !min.Valid && !max.Valid {
		return nil
	}
	record := domain.MarketRange{}
	if min.Valid {
		record.Min = &min.Float64
	}
	if max.Valid {
		record.Max = &max.Float64
	}
	return &record
}

func intRange(min, max sql.NullInt64) *domain.MarketRange {
	if !min.Valid && !max.Valid {
		return nil
	}
	record := domain.MarketRange{}
	if min.Valid {
		value := float64(min.Int64)
		record.Min = &value
	}
	if max.Valid {
		value := float64(max.Int64)
		record.Max = &value
	}
	return &record
}
