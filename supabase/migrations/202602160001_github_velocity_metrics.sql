-- Add velocity metrics to github_references
ALTER TABLE github_references
  ADD COLUMN IF NOT EXISTS first_commit_date timestamptz,
  ADD COLUMN IF NOT EXISTS last_commit_date timestamptz,
  ADD COLUMN IF NOT EXISTS total_commits integer,
  ADD COLUMN IF NOT EXISTS commits_per_week numeric,
  ADD COLUMN IF NOT EXISTS contributor_count integer,
  ADD COLUMN IF NOT EXISTS core_contributors integer,
  ADD COLUMN IF NOT EXISTS total_additions bigint,
  ADD COLUMN IF NOT EXISTS total_deletions bigint,
  ADD COLUMN IF NOT EXISTS velocity_data jsonb,
  ADD COLUMN IF NOT EXISTS velocity_analyzed_at timestamptz;

-- Index for velocity queries
CREATE INDEX IF NOT EXISTS idx_github_references_velocity
  ON github_references (velocity_analyzed_at)
  WHERE velocity_data IS NOT NULL;
