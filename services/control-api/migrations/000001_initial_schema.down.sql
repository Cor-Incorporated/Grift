-- Reverse of 000001_initial_schema.up.sql
-- Drop in reverse dependency order

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS api_usage_logs CASCADE;
DROP TABLE IF EXISTS data_sources CASCADE;
DROP TABLE IF EXISTS pricing_policies CASCADE;
DROP TABLE IF EXISTS change_classifications CASCADE;
DROP TABLE IF EXISTS handoff_issue_mappings CASCADE;
DROP TABLE IF EXISTS handoff_packages CASCADE;
DROP TABLE IF EXISTS approval_decisions CASCADE;
DROP TABLE IF EXISTS proposal_sessions CASCADE;
DROP TABLE IF EXISTS estimates CASCADE;
DROP TABLE IF EXISTS aggregated_evidences CASCADE;
DROP TABLE IF EXISTS evidence_fragments CASCADE;
DROP TABLE IF EXISTS project_outcomes CASCADE;
DROP TABLE IF EXISTS inbound_webhook_receipts CASCADE;
DROP TABLE IF EXISTS processed_events CASCADE;
DROP TABLE IF EXISTS outbox_events CASCADE;
DROP TABLE IF EXISTS repository_snapshots CASCADE;
DROP TABLE IF EXISTS requirement_artifacts CASCADE;
DROP TABLE IF EXISTS chunk_embeddings CASCADE;
DROP TABLE IF EXISTS document_chunks CASCADE;
DROP TABLE IF EXISTS source_documents CASCADE;
DROP TABLE IF EXISTS conversation_turns CASCADE;
DROP TABLE IF EXISTS cases CASCADE;
DROP TABLE IF EXISTS tenant_members CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Roles (only drop if no other objects depend on them)
DO $$
BEGIN
  DROP ROLE IF EXISTS app_user;
  DROP ROLE IF EXISTS job_worker;
  DROP ROLE IF EXISTS maintenance_admin;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not drop roles: %', SQLERRM;
END
$$;

DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS vector;
DROP EXTENSION IF EXISTS "uuid-ossp";
