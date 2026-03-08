-- Repository Intelligence Context
-- GitHub App installations, repositories, and velocity metrics
-- Follows RLS pattern from ADR-0007 (initial_schema)

-- ============================================================
-- GitHub Installations
-- ============================================================
CREATE TABLE github_installations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  installation_id BIGINT NOT NULL,
  app_id          BIGINT NOT NULL,
  account_login   TEXT NOT NULL,
  account_type    TEXT NOT NULL CHECK (account_type IN ('Organization', 'User')),
  permissions     JSONB NOT NULL DEFAULT '{}',
  events          JSONB NOT NULL DEFAULT '[]',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, installation_id)
);

ALTER TABLE github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_installations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_github_installations ON github_installations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON github_installations TO app_user;
GRANT SELECT, INSERT, UPDATE ON github_installations TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON github_installations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Repositories
-- ============================================================
CREATE TABLE repositories (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  installation_id   UUID REFERENCES github_installations(id) ON DELETE SET NULL,
  github_id         BIGINT UNIQUE,
  org_name          TEXT,
  repo_name         TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  description       TEXT,
  language          TEXT,
  stars             INTEGER NOT NULL DEFAULT 0,
  topics            TEXT[] NOT NULL DEFAULT '{}',
  tech_stack        TEXT[] NOT NULL DEFAULT '{}',
  total_commits     INTEGER NOT NULL DEFAULT 0,
  contributor_count INTEGER NOT NULL DEFAULT 0,
  is_private        BOOLEAN NOT NULL DEFAULT false,
  is_archived       BOOLEAN NOT NULL DEFAULT false,
  synced_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, full_name)
);

CREATE INDEX idx_repositories_tenant_org ON repositories(tenant_id, org_name);
CREATE INDEX idx_repositories_tenant_full_name ON repositories(tenant_id, full_name);

ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE repositories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_repositories ON repositories
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON repositories TO app_user;
GRANT SELECT, INSERT, UPDATE ON repositories TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON repositories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Velocity Metrics (append-only)
-- ============================================================
CREATE TABLE velocity_metrics (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  repository_id       UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commits_per_week    NUMERIC(10,2),
  active_days_per_week NUMERIC(5,2),
  pr_merge_frequency  NUMERIC(10,2),
  issue_close_speed   NUMERIC(10,2),
  churn_rate          NUMERIC(5,4),
  contributor_count   INTEGER,
  velocity_score      NUMERIC(5,2) CHECK (velocity_score >= 0 AND velocity_score <= 100),
  estimated_hours     NUMERIC(10,2),
  analyzed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_velocity_metrics_repo ON velocity_metrics(tenant_id, repository_id, analyzed_at DESC);

ALTER TABLE velocity_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE velocity_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_velocity_metrics ON velocity_metrics
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- velocity_metrics is append-only: SELECT + INSERT only
GRANT SELECT, INSERT ON velocity_metrics TO app_user;
GRANT SELECT, INSERT ON velocity_metrics TO job_worker;

-- ============================================================
-- maintenance_admin: grant on new tables
-- ============================================================
GRANT ALL ON github_installations TO maintenance_admin;
GRANT ALL ON repositories TO maintenance_admin;
GRANT ALL ON velocity_metrics TO maintenance_admin;
