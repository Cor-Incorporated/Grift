-- Evidence-based estimation pipeline: new columns for estimates table
-- Stores evidence bundle, calibration data, and cross-validation results

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS evidence_bundle jsonb,
  ADD COLUMN IF NOT EXISTS calibration_ratio numeric,
  ADD COLUMN IF NOT EXISTS historical_citations jsonb,
  ADD COLUMN IF NOT EXISTS cross_validation jsonb;

-- Full-text search index on github_references.description for similarity matching
CREATE INDEX IF NOT EXISTS idx_github_references_description_fts
  ON github_references USING gin(to_tsvector('english', coalesce(description, '')));

COMMENT ON COLUMN estimates.evidence_bundle IS 'Full evidence bundle used for estimation (similar projects, historical calibration, code impact)';
COMMENT ON COLUMN estimates.calibration_ratio IS 'Ratio between AI estimate and historical actual hours (>2.0 triggers warning)';
COMMENT ON COLUMN estimates.historical_citations IS 'Structured citations from similar project references';
COMMENT ON COLUMN estimates.cross_validation IS 'Cross-validation result reconciling AI, historical, and velocity estimates';
