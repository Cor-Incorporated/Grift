-- Linear integration: Add sync columns to estimates and create issue mapping table

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS linear_project_id text,
  ADD COLUMN IF NOT EXISTS linear_sync_status text DEFAULT 'not_synced'
    CHECK (linear_sync_status IN ('not_synced', 'syncing', 'synced', 'error'));

CREATE TABLE IF NOT EXISTS linear_issue_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_name text NOT NULL,
  phase_name text,
  linear_issue_id text NOT NULL,
  linear_issue_identifier text,
  linear_issue_url text NOT NULL,
  linear_team_id text,
  linear_cycle_id text,
  sync_status text NOT NULL DEFAULT 'created',
  hours_estimate numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (estimate_id, module_name)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_linear_issue_mappings_estimate_id ON linear_issue_mappings(estimate_id);
CREATE INDEX IF NOT EXISTS idx_linear_issue_mappings_project_id ON linear_issue_mappings(project_id);
CREATE INDEX IF NOT EXISTS idx_linear_issue_mappings_linear_issue_id ON linear_issue_mappings(linear_issue_id);
