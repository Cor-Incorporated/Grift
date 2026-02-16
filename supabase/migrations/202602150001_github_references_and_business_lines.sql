-- github_references テーブル（ポートフォリオ/実績管理）
CREATE TABLE IF NOT EXISTS github_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name text NOT NULL,
  repo_name text NOT NULL,
  full_name text GENERATED ALWAYS AS (org_name || '/' || repo_name) STORED,
  description text,
  language text,
  stars integer DEFAULT 0,
  topics text[] DEFAULT '{}',
  is_showcase boolean DEFAULT false,
  hours_spent numeric,
  pr_title text,
  pr_number integer,
  analysis_summary text,
  analysis_result jsonb,
  tech_stack text[] DEFAULT '{}',
  project_type text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz,
  created_by_clerk_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_name, repo_name)
);

CREATE INDEX IF NOT EXISTS idx_github_references_showcase ON github_references(is_showcase) WHERE is_showcase = true;
CREATE INDEX IF NOT EXISTS idx_github_references_tech_stack ON github_references USING gin(tech_stack);

-- projects に business_line 追加
ALTER TABLE projects ADD COLUMN IF NOT EXISTS business_line text
  CHECK (business_line IN ('boltsite', 'iotrealm', 'tapforge'));

-- estimates に go_no_go_result, value_proposition 追加
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS go_no_go_result jsonb,
  ADD COLUMN IF NOT EXISTS value_proposition jsonb;
