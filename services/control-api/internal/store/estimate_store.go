package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// EstimateStore defines the persistence operations for estimates.
type EstimateStore interface {
	// Create inserts a new estimate and returns it with server-generated fields populated.
	Create(ctx context.Context, e *domain.Estimate) (*domain.Estimate, error)
	// GetByID returns a single estimate by ID scoped to a tenant and case. Returns nil if not found.
	GetByID(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error)
	// ListByCaseID returns estimates for a case with pagination.
	ListByCaseID(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error)
	// UpdateThreeWayProposal sets the three_way_proposal JSON on an estimate.
	UpdateThreeWayProposal(ctx context.Context, tenantID, estimateID uuid.UUID, proposal json.RawMessage) error
}

// SQLEstimateStore implements EstimateStore using a SQL database.
type SQLEstimateStore struct {
	db *sql.DB
}

// NewSQLEstimateStore creates a new SQLEstimateStore backed by the given database.
func NewSQLEstimateStore(db *sql.DB) *SQLEstimateStore {
	if db == nil {
		panic("db must not be nil")
	}
	return &SQLEstimateStore{db: db}
}

// executor returns the RLS-scoped transaction from context if available, otherwise the pool.
func (s *SQLEstimateStore) executor(ctx context.Context) dbExecutor {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return s.db
}

// Create inserts a new estimate row and returns the estimate with server-generated timestamps.
func (s *SQLEstimateStore) Create(ctx context.Context, e *domain.Estimate) (*domain.Estimate, error) {
	exec := s.executor(ctx)

	row := exec.QueryRowContext(ctx,
		`INSERT INTO estimates (
			id, tenant_id, case_id, estimate_mode, status,
			your_hourly_rate, your_estimated_hours, total_your_cost,
			hours_investigation, hours_implementation, hours_testing, hours_buffer,
			hours_breakdown_report,
			market_hourly_rate, market_estimated_hours, total_market_cost,
			multiplier, aggregated_evidence_id,
			pricing_snapshot, risk_flags, calibration_ratio,
			historical_citations, three_way_proposal,
			go_no_go_result, value_proposition
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8,
			$9, $10, $11, $12,
			$13,
			$14, $15, $16,
			$17, $18,
			$19, $20, $21,
			$22, $23,
			$24, $25
		)
		RETURNING created_at, updated_at`,
		e.ID, e.TenantID, e.CaseID, e.EstimateMode, e.Status,
		e.YourHourlyRate, e.YourEstimatedHours, e.TotalYourCost,
		e.HoursInvestigation, e.HoursImplementation, e.HoursTesting, e.HoursBuffer,
		e.HoursBreakdownReport,
		e.MarketHourlyRate, e.MarketEstimatedHours, e.TotalMarketCost,
		e.Multiplier, e.AggregatedEvidenceID,
		e.PricingSnapshot, pq.Array(e.RiskFlags), e.CalibrationRatio,
		e.HistoricalCitations, e.ThreeWayProposal,
		e.GoNoGoResult, e.ValueProposition,
	)
	if err := row.Scan(&e.CreatedAt, &e.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert estimate: %w", err)
	}

	return e, nil
}

// GetByID retrieves a single estimate by ID, scoped to a tenant and case. Returns nil if not found.
func (s *SQLEstimateStore) GetByID(ctx context.Context, tenantID, caseID, estimateID uuid.UUID) (*domain.Estimate, error) {
	exec := s.executor(ctx)

	row := exec.QueryRowContext(ctx,
		`SELECT id, tenant_id, case_id, estimate_mode, status,
			your_hourly_rate, your_estimated_hours, total_your_cost,
			hours_investigation, hours_implementation, hours_testing, hours_buffer,
			hours_breakdown_report,
			market_hourly_rate, market_estimated_hours, total_market_cost,
			multiplier, aggregated_evidence_id,
			pricing_snapshot, risk_flags, calibration_ratio,
			historical_citations, three_way_proposal,
			go_no_go_result, value_proposition,
			created_at, updated_at
		FROM estimates
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3`,
		tenantID, caseID, estimateID,
	)

	record, err := scanEstimate(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get estimate: %w", err)
	}

	return record, nil
}

// ListByCaseID returns estimates for a case with pagination.
func (s *SQLEstimateStore) ListByCaseID(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]domain.Estimate, int, error) {
	exec := s.executor(ctx)

	var total int
	if err := exec.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM estimates WHERE tenant_id = $1 AND case_id = $2`,
		tenantID, caseID,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count estimates: %w", err)
	}

	rows, err := exec.QueryContext(ctx,
		`SELECT id, tenant_id, case_id, estimate_mode, status,
			your_hourly_rate, your_estimated_hours, total_your_cost,
			hours_investigation, hours_implementation, hours_testing, hours_buffer,
			hours_breakdown_report,
			market_hourly_rate, market_estimated_hours, total_market_cost,
			multiplier, aggregated_evidence_id,
			pricing_snapshot, risk_flags, calibration_ratio,
			historical_citations, three_way_proposal,
			go_no_go_result, value_proposition,
			created_at, updated_at
		FROM estimates
		WHERE tenant_id = $1 AND case_id = $2
		ORDER BY created_at DESC
		LIMIT $3 OFFSET $4`,
		tenantID, caseID, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list estimates: %w", err)
	}
	defer rows.Close()

	var records []domain.Estimate
	for rows.Next() {
		record, err := scanEstimate(rows)
		if err != nil {
			return nil, 0, err
		}
		records = append(records, *record)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate estimates: %w", err)
	}

	return records, total, nil
}

// UpdateThreeWayProposal sets the three_way_proposal JSON on an estimate.
func (s *SQLEstimateStore) UpdateThreeWayProposal(ctx context.Context, tenantID, estimateID uuid.UUID, proposal json.RawMessage) error {
	exec := s.executor(ctx)

	result, err := exec.ExecContext(ctx,
		`UPDATE estimates SET three_way_proposal = $3, updated_at = NOW()
		WHERE tenant_id = $1 AND id = $2`,
		tenantID, estimateID, proposal,
	)
	if err != nil {
		return fmt.Errorf("update three_way_proposal: %w", err)
	}

	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update three_way_proposal rows affected: %w", err)
	}
	if n == 0 {
		return sql.ErrNoRows
	}

	return nil
}

// scanEstimate scans an estimate row into a domain.Estimate.
func scanEstimate(scanner rowScanner) (*domain.Estimate, error) {
	var (
		record               domain.Estimate
		hoursInvestigation   sql.NullFloat64
		hoursImplementation  sql.NullFloat64
		hoursTesting         sql.NullFloat64
		hoursBuffer          sql.NullFloat64
		hoursBreakdownReport sql.NullString
		marketHourlyRate     sql.NullFloat64
		marketEstimatedHours sql.NullFloat64
		totalMarketCost      sql.NullFloat64
		aggregatedEvidenceID uuid.NullUUID
		pricingSnapshot      []byte
		calibrationRatio     sql.NullFloat64
		historicalCitations  []byte
		threeWayProposal     []byte
		goNoGoResult         []byte
		valueProposition     []byte
	)

	if err := scanner.Scan(
		&record.ID,
		&record.TenantID,
		&record.CaseID,
		&record.EstimateMode,
		&record.Status,
		&record.YourHourlyRate,
		&record.YourEstimatedHours,
		&record.TotalYourCost,
		&hoursInvestigation,
		&hoursImplementation,
		&hoursTesting,
		&hoursBuffer,
		&hoursBreakdownReport,
		&marketHourlyRate,
		&marketEstimatedHours,
		&totalMarketCost,
		&record.Multiplier,
		&aggregatedEvidenceID,
		&pricingSnapshot,
		pq.Array(&record.RiskFlags),
		&calibrationRatio,
		&historicalCitations,
		&threeWayProposal,
		&goNoGoResult,
		&valueProposition,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return nil, err
	}

	if hoursInvestigation.Valid {
		record.HoursInvestigation = &hoursInvestigation.Float64
	}
	if hoursImplementation.Valid {
		record.HoursImplementation = &hoursImplementation.Float64
	}
	if hoursTesting.Valid {
		record.HoursTesting = &hoursTesting.Float64
	}
	if hoursBuffer.Valid {
		record.HoursBuffer = &hoursBuffer.Float64
	}
	if hoursBreakdownReport.Valid {
		record.HoursBreakdownReport = &hoursBreakdownReport.String
	}
	if marketHourlyRate.Valid {
		record.MarketHourlyRate = &marketHourlyRate.Float64
	}
	if marketEstimatedHours.Valid {
		record.MarketEstimatedHours = &marketEstimatedHours.Float64
	}
	if totalMarketCost.Valid {
		record.TotalMarketCost = &totalMarketCost.Float64
	}
	if aggregatedEvidenceID.Valid {
		record.AggregatedEvidenceID = &aggregatedEvidenceID.UUID
	}
	if calibrationRatio.Valid {
		record.CalibrationRatio = &calibrationRatio.Float64
	}
	if len(pricingSnapshot) > 0 {
		record.PricingSnapshot = json.RawMessage(pricingSnapshot)
	}
	if len(historicalCitations) > 0 {
		record.HistoricalCitations = json.RawMessage(historicalCitations)
	}
	if len(threeWayProposal) > 0 {
		record.ThreeWayProposal = json.RawMessage(threeWayProposal)
	}
	if len(goNoGoResult) > 0 {
		record.GoNoGoResult = json.RawMessage(goNoGoResult)
	}
	if len(valueProposition) > 0 {
		record.ValueProposition = json.RawMessage(valueProposition)
	}
	if record.RiskFlags == nil {
		record.RiskFlags = []string{}
	}

	return &record, nil
}
