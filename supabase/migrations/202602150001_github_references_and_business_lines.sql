-- github_references テーブルに不足カラムを追加（既存テーブルなので ALTER TABLE を使用）
-- 注: 初期マイグレーション create_github_references で基本カラムは作成済み
ALTER TABLE github_references
  ADD COLUMN IF NOT EXISTS full_name text GENERATED ALWAYS AS (org_name || '/' || repo_name) STORED,
  ADD COLUMN IF NOT EXISTS stars integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topics text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_showcase boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS analysis_summary text,
  ADD COLUMN IF NOT EXISTS analysis_result jsonb,
  ADD COLUMN IF NOT EXISTS tech_stack text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS project_type text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_clerk_user_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_github_references_showcase ON github_references(is_showcase) WHERE is_showcase = true;
CREATE INDEX IF NOT EXISTS idx_github_references_tech_stack ON github_references USING gin(tech_stack);

-- projects に business_line 追加
ALTER TABLE projects ADD COLUMN IF NOT EXISTS business_line text
  CHECK (business_line IN ('boltsite', 'iotrealm', 'tapforge'));

-- estimates に go_no_go_result, value_proposition 追加
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS go_no_go_result jsonb,
  ADD COLUMN IF NOT EXISTS value_proposition jsonb;
