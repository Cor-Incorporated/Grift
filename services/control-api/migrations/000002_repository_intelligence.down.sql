-- Reverse of 000002_repository_intelligence.up.sql
-- Drop in reverse dependency order

DROP TRIGGER IF EXISTS set_updated_at ON repositories;
DROP TRIGGER IF EXISTS set_updated_at ON github_installations;

DROP POLICY IF EXISTS tenant_isolation_velocity_metrics ON velocity_metrics;
DROP POLICY IF EXISTS tenant_isolation_repositories ON repositories;
DROP POLICY IF EXISTS tenant_isolation_github_installations ON github_installations;

DROP TABLE IF EXISTS velocity_metrics CASCADE;
DROP TABLE IF EXISTS repositories CASCADE;
DROP TABLE IF EXISTS github_installations CASCADE;
