CREATE TABLE estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    estimate_mode TEXT NOT NULL DEFAULT 'market_comparison',
    status TEXT NOT NULL DEFAULT 'draft',
    your_hourly_rate NUMERIC NOT NULL,
    your_estimated_hours NUMERIC NOT NULL DEFAULT 0,
    total_your_cost NUMERIC NOT NULL DEFAULT 0,
    hours_investigation NUMERIC,
    hours_implementation NUMERIC,
    hours_testing NUMERIC,
    hours_buffer NUMERIC,
    hours_breakdown_report TEXT,
    market_hourly_rate NUMERIC,
    market_estimated_hours NUMERIC,
    total_market_cost NUMERIC,
    multiplier NUMERIC NOT NULL DEFAULT 1.8,
    aggregated_evidence_id UUID REFERENCES aggregated_evidences(id),
    pricing_snapshot JSONB DEFAULT '{}',
    risk_flags TEXT[] DEFAULT '{}',
    calibration_ratio NUMERIC,
    historical_citations JSONB DEFAULT '{}',
    three_way_proposal JSONB DEFAULT '{}',
    go_no_go_result JSONB DEFAULT '{}',
    value_proposition JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_estimates_case ON estimates(tenant_id, case_id);

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON estimates
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
