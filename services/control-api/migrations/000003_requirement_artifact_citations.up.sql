ALTER TABLE requirement_artifacts
  ADD COLUMN IF NOT EXISTS citations JSONB NOT NULL DEFAULT '[]';
