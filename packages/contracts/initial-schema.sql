-- BenevolentDirector v2 Initial Schema
-- Cloud SQL PostgreSQL 15+ with pgvector
-- ADR-0007: Cloud SQL native RLS + app RBAC dual guard
-- ADR-0008: Embedding model separation + versioned vector schema
-- ADR-0009: Outbox pattern + idempotent event processing
-- ADR-0010: Data governance (retention, classification)

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- Roles (ADR-0007)
-- ============================================================
-- app_user: 通常 API 用（BYPASSRLS なし）
-- job_worker: 非同期ジョブ用（BYPASSRLS なし）
-- maintenance_admin: マイグレーション / 監査用（BYPASSRLS あり、本番常用しない）

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'job_worker') THEN
    CREATE ROLE job_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'maintenance_admin') THEN
    CREATE ROLE maintenance_admin NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- ============================================================
-- Helper: updated_at 自動更新トリガー
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Helper: RLS policy template
-- ============================================================
-- 全テナントテーブルに適用するマクロ的パターン:
--   ENABLE ROW LEVEL SECURITY;
--   FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
--   WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- Tenants
-- ============================================================
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan              TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  settings          JSONB NOT NULL DEFAULT '{}',
  analytics_opt_in  BOOLEAN NOT NULL DEFAULT FALSE,
  training_opt_in   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tenants テーブルは RLS 対象外（テナント自身の検索に使うため）
-- アクセス制御はアプリ層で行う

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Tenant Members
-- ============================================================
CREATE TABLE tenant_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  firebase_uid  TEXT NOT NULL,
  email         TEXT,
  display_name  TEXT,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'member', 'viewer')),
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, firebase_uid)
);

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_members ON tenant_members
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_members TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_members TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenant_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Cases (Intake Context)
-- v1: projects → v2: cases
-- ============================================================
CREATE TABLE cases (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title               TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'undetermined'
                        CHECK (type IN ('new_project', 'bug_report', 'fix_request', 'feature_addition', 'undetermined')),
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'interviewing', 'analyzing', 'estimating', 'proposed', 'approved', 'rejected', 'on_hold')),
  priority            TEXT CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  business_line       TEXT,
  existing_system_url TEXT,
  spec_markdown       TEXT,
  contact_name        TEXT,
  contact_email       TEXT,
  company_name        TEXT,
  created_by_uid      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cases_tenant_id ON cases(tenant_id);
CREATE INDEX idx_cases_status ON cases(tenant_id, status);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cases ON cases
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON cases TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON cases TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Conversation Turns (Intake Context)
-- v1: conversations → v2: conversation_turns
-- ============================================================
CREATE TABLE conversation_turns (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  source_domain          TEXT NOT NULL DEFAULT 'unknown',
  training_eligible      BOOLEAN NOT NULL DEFAULT false,
  model_used             TEXT,
  system_prompt_version  TEXT,
  fallback_used          BOOLEAN NOT NULL DEFAULT false,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- conversation_turns は append-only（更新不可）。job_worker にも UPDATE 権限なし。
CREATE INDEX idx_conversation_turns_case ON conversation_turns(tenant_id, case_id, created_at);

ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_conversation_turns ON conversation_turns
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT ON conversation_turns TO app_user;
GRANT SELECT, INSERT ON conversation_turns TO job_worker;

-- ============================================================
-- Observation QA Pairs (Observation Pipeline Context, append-only)
-- ADR-0015: 非同期抽出された QA ペアと品質スコアを保存
-- ============================================================
CREATE TABLE qa_pairs (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id         UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  turn_range         INT4RANGE NOT NULL,
  question_text      TEXT NOT NULL,
  answer_text        TEXT NOT NULL,
  source_domain      TEXT NOT NULL DEFAULT 'unknown',
  training_eligible  BOOLEAN NOT NULL DEFAULT false,
  confidence         NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  completeness       NUMERIC(4,3) NOT NULL CHECK (completeness BETWEEN 0 AND 1),
  coherence          NUMERIC(4,3) NOT NULL CHECK (coherence BETWEEN 0 AND 1),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qa_pairs_session ON qa_pairs(tenant_id, session_id, created_at DESC);
CREATE INDEX idx_qa_pairs_source_domain ON qa_pairs(tenant_id, source_domain, created_at DESC);
CREATE INDEX idx_qa_pairs_training_eligible ON qa_pairs(tenant_id, training_eligible, created_at DESC);

ALTER TABLE qa_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_pairs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_qa_pairs ON qa_pairs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- qa_pairs is append-only: SELECT + INSERT only
GRANT SELECT, INSERT ON qa_pairs TO app_user;
GRANT SELECT, INSERT ON qa_pairs TO job_worker;

-- ============================================================
-- Completeness Tracking (Observation Pipeline, ADR-0015.6)
-- セッションごとのヒアリング完了度を追跡。フィードバックループで
-- 次ターンの System Prompt に未収集項目を注入する。
-- ============================================================
CREATE TABLE completeness_tracking (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id              UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  source_domain           TEXT NOT NULL DEFAULT 'estimation',
  checklist               JSONB NOT NULL DEFAULT '{}',
  overall_completeness    NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (overall_completeness BETWEEN 0 AND 1),
  suggested_next_topics   TEXT[] NOT NULL DEFAULT '{}',
  turn_count              INTEGER NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_id, source_domain)
);

CREATE INDEX idx_completeness_tracking_session ON completeness_tracking(tenant_id, session_id);

ALTER TABLE completeness_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE completeness_tracking FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_completeness_tracking ON completeness_tracking
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON completeness_tracking TO app_user;
GRANT SELECT, INSERT, UPDATE ON completeness_tracking TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON completeness_tracking
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Dead Letter Events (ADR-0015.8)
-- 抽出失敗イベントを記録。リトライ制御と障害分析に使用。
-- ============================================================
CREATE TABLE dead_letter_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  event_id        UUID NOT NULL,
  event_type      TEXT NOT NULL,
  reason          TEXT NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  last_retried_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  original_payload JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dead_letter_unresolved ON dead_letter_events(event_type, created_at) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX dead_letter_events_event_id_unresolved ON dead_letter_events (event_id) WHERE resolved_at IS NULL;

-- CI ガードレール: tenant_id を持つテーブルは RLS 必須
ALTER TABLE dead_letter_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letter_events FORCE ROW LEVEL SECURITY;

-- job_worker はクロステナントで処理するため全行アクセスを許可
CREATE POLICY dead_letter_job_worker ON dead_letter_events
  FOR ALL TO job_worker USING (true) WITH CHECK (true);

-- app_user は自テナントの参照のみ
CREATE POLICY dead_letter_app_user ON dead_letter_events
  FOR SELECT TO app_user USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON dead_letter_events TO job_worker;
GRANT SELECT ON dead_letter_events TO app_user;

-- ============================================================
-- Source Documents (Intake Context)
-- v1: project_files → v2: source_documents
-- ============================================================
CREATE TABLE source_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id         UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  file_type       TEXT,
  file_size       BIGINT,
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('file_upload', 'repository_url', 'website_url')),
  source_url      TEXT,
  gcs_path        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  analysis_error  TEXT,
  analysis_result JSONB,
  analyzed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_documents_case ON source_documents(tenant_id, case_id);

ALTER TABLE source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_source_documents ON source_documents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON source_documents TO app_user;
GRANT SELECT, INSERT, UPDATE ON source_documents TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON source_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Document Chunks + Embeddings (ADR-0008)
-- ============================================================
CREATE TABLE document_chunks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  namespace       TEXT NOT NULL CHECK (namespace IN ('customer_docs', 'case_memory', 'repo_intelligence', 'requirement_artifacts')),
  source_type     TEXT NOT NULL,
  source_id       UUID NOT NULL,
  chunk_index     INTEGER NOT NULL,
  content         TEXT NOT NULL,
  content_sha256  TEXT NOT NULL,
  token_count     INTEGER NOT NULL,
  metadata_json   JSONB NOT NULL DEFAULT '{}',
  chunk_version   INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_id, chunk_index, chunk_version)
);

CREATE INDEX idx_document_chunks_source ON document_chunks(tenant_id, source_id);
CREATE INDEX idx_document_chunks_namespace ON document_chunks(tenant_id, namespace);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_document_chunks ON document_chunks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON document_chunks TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_chunks TO job_worker;

CREATE TABLE chunk_embeddings (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  chunk_id                UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  namespace               TEXT NOT NULL,
  embedding_model_version TEXT NOT NULL,
  embedding_dimensions    INTEGER NOT NULL,
  vector                  vector,  -- dimension は embedding_model_version に依存
  embedded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active               BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (chunk_id, embedding_model_version)
);

CREATE INDEX idx_chunk_embeddings_search ON chunk_embeddings(tenant_id, namespace, is_active);
-- HNSW index は embedding_dimensions 確定後に作成:
-- CREATE INDEX idx_chunk_embeddings_vector ON chunk_embeddings
--   USING hnsw (vector vector_cosine_ops) WHERE is_active = true;

ALTER TABLE chunk_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunk_embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chunk_embeddings ON chunk_embeddings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON chunk_embeddings TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON chunk_embeddings TO job_worker;

-- ============================================================
-- Requirement Artifacts (Estimation Context)
-- ============================================================
CREATE TABLE requirement_artifacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id         UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL DEFAULT 1,
  markdown        TEXT NOT NULL,
  source_chunks   UUID[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  created_by_uid  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);

ALTER TABLE requirement_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_requirement_artifacts ON requirement_artifacts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON requirement_artifacts TO app_user;
GRANT SELECT, INSERT, UPDATE ON requirement_artifacts TO job_worker;

CREATE INDEX idx_requirement_artifacts_case ON requirement_artifacts(tenant_id, case_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON requirement_artifacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Repository Snapshots (Repository Intelligence Context)
-- v1: github_references → v2: repository_snapshots
-- ============================================================
CREATE TABLE repository_snapshots (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  org_name            TEXT NOT NULL,
  repo_name           TEXT NOT NULL,
  full_name           TEXT NOT NULL,
  description         TEXT,
  language            TEXT,
  stars               INTEGER NOT NULL DEFAULT 0,
  topics              TEXT[] NOT NULL DEFAULT '{}',
  tech_stack          TEXT[] NOT NULL DEFAULT '{}',
  is_showcase         BOOLEAN NOT NULL DEFAULT false,
  hours_spent         NUMERIC,
  total_commits       INTEGER,
  commits_per_week    NUMERIC,
  contributor_count   INTEGER,
  core_contributors   INTEGER,
  total_additions     BIGINT,
  total_deletions     BIGINT,
  first_commit_date   DATE,
  last_commit_date    DATE,
  velocity_data       JSONB,
  velocity_analyzed_at TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, full_name)
);

CREATE INDEX idx_repo_snapshots_tenant ON repository_snapshots(tenant_id);
CREATE INDEX idx_repo_snapshots_org ON repository_snapshots(tenant_id, org_name);

ALTER TABLE repository_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE repository_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_repository_snapshots ON repository_snapshots
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON repository_snapshots TO app_user;
GRANT SELECT, INSERT, UPDATE ON repository_snapshots TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON repository_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Market Evidence (Market Benchmark Context)
-- v1: market_evidence (single provider) → v2: fragments + aggregated
-- ============================================================
CREATE TABLE evidence_fragments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id             UUID REFERENCES cases(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL CHECK (provider IN ('grok', 'brave', 'perplexity', 'gemini')),
  case_type           TEXT NOT NULL,
  query               TEXT NOT NULL,
  hourly_rate_min     NUMERIC,
  hourly_rate_max     NUMERIC,
  total_hours_min     NUMERIC,
  total_hours_max     NUMERIC,
  team_size_min       INTEGER,
  team_size_max       INTEGER,
  duration_weeks_min  INTEGER,
  duration_weeks_max  INTEGER,
  citations           JSONB NOT NULL DEFAULT '[]',
  provider_confidence NUMERIC NOT NULL DEFAULT 0 CHECK (provider_confidence BETWEEN 0 AND 1),
  raw_response        TEXT,
  retrieved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_fragments_case ON evidence_fragments(tenant_id, case_id);

ALTER TABLE evidence_fragments ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_fragments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_evidence_fragments ON evidence_fragments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT ON evidence_fragments TO app_user;
GRANT SELECT, INSERT ON evidence_fragments TO job_worker;

CREATE TABLE aggregated_evidences (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id               UUID REFERENCES cases(id) ON DELETE SET NULL,
  fragment_ids          UUID[] NOT NULL DEFAULT '{}',
  consensus_hours_min   NUMERIC,
  consensus_hours_max   NUMERIC,
  consensus_rate_min    NUMERIC,
  consensus_rate_max    NUMERIC,
  overall_confidence    TEXT NOT NULL CHECK (overall_confidence IN ('high', 'medium', 'low')),
  contradictions        JSONB NOT NULL DEFAULT '[]',
  requires_human_review BOOLEAN NOT NULL DEFAULT false,
  aggregated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE aggregated_evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregated_evidences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_aggregated_evidences ON aggregated_evidences
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT ON aggregated_evidences TO app_user;
GRANT SELECT, INSERT ON aggregated_evidences TO job_worker;

CREATE INDEX idx_aggregated_evidences_case ON aggregated_evidences(tenant_id, case_id);

-- ============================================================
-- Estimates (Estimation Context)
-- ============================================================
CREATE TABLE estimates (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id                 UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  estimate_mode           TEXT NOT NULL CHECK (estimate_mode IN ('market_comparison', 'hours_only', 'hybrid')),
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'approved', 'rejected')),
  your_hourly_rate        NUMERIC NOT NULL,
  your_estimated_hours    NUMERIC NOT NULL DEFAULT 0,
  total_your_cost         NUMERIC NOT NULL DEFAULT 0,
  hours_investigation     NUMERIC,
  hours_implementation    NUMERIC,
  hours_testing           NUMERIC,
  hours_buffer            NUMERIC,
  hours_breakdown_report  TEXT,
  market_hourly_rate      NUMERIC,
  market_estimated_hours  NUMERIC,
  total_market_cost       NUMERIC,
  multiplier              NUMERIC NOT NULL DEFAULT 1.8,
  aggregated_evidence_id  UUID REFERENCES aggregated_evidences(id),
  pricing_snapshot        JSONB,
  risk_flags              TEXT[] NOT NULL DEFAULT '{}',
  calibration_ratio       NUMERIC,
  historical_citations    JSONB,
  three_way_proposal      JSONB,
  go_no_go_result         JSONB,
  value_proposition       JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_estimates_case ON estimates(tenant_id, case_id);

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_estimates ON estimates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON estimates TO app_user;
GRANT SELECT, INSERT, UPDATE ON estimates TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Proposal Sessions & Approval Decisions (Proposal & Approval Context)
-- ============================================================
CREATE TABLE proposal_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id       UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  estimate_id   UUID NOT NULL REFERENCES estimates(id),
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'presented', 'approved', 'rejected', 'expired')),
  presented_at  TIMESTAMPTZ,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE proposal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_proposal_sessions ON proposal_sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON proposal_sessions TO app_user;
GRANT SELECT ON proposal_sessions TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON proposal_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE approval_decisions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  proposal_id     UUID NOT NULL REFERENCES proposal_sessions(id) ON DELETE CASCADE,
  decision        TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_by_uid  TEXT NOT NULL,
  decided_by_role TEXT,
  comment         TEXT,
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approval_decisions ON approval_decisions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT ON approval_decisions TO app_user;
GRANT SELECT ON approval_decisions TO job_worker;

-- ============================================================
-- Handoff Packages (Handoff Context)
-- ============================================================
CREATE TABLE handoff_packages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id             UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  estimate_id         UUID NOT NULL REFERENCES estimates(id),
  linear_project_id   TEXT,
  linear_project_url  TEXT,
  github_project_url  TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'syncing', 'synced', 'error')),
  error_message       TEXT,
  idempotency_key     UUID NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE handoff_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_handoff_packages ON handoff_packages
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON handoff_packages TO app_user;
GRANT SELECT, INSERT, UPDATE ON handoff_packages TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON handoff_packages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE handoff_issue_mappings (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  handoff_id              UUID NOT NULL REFERENCES handoff_packages(id) ON DELETE CASCADE,
  module_name             TEXT NOT NULL,
  phase_name              TEXT,
  linear_issue_id         TEXT,
  linear_issue_identifier TEXT,
  linear_issue_url        TEXT,
  github_issue_number     INTEGER,
  github_issue_url        TEXT,
  hours_estimate          NUMERIC,
  source_event_id         TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE handoff_issue_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_issue_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_handoff_issue_mappings ON handoff_issue_mappings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON handoff_issue_mappings TO app_user;
GRANT SELECT, INSERT, UPDATE ON handoff_issue_mappings TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON handoff_issue_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Change Classifications (Handoff Context)
-- ============================================================
CREATE TABLE change_classifications (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id                     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  description                 TEXT NOT NULL,
  requirement_artifact_id     UUID REFERENCES requirement_artifacts(id),
  classification              TEXT NOT NULL CHECK (classification IN ('bug_fix', 'additional_scope')),
  confidence                  NUMERIC NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reasoning                   TEXT NOT NULL,
  matched_requirement_sections TEXT[] NOT NULL DEFAULT '{}',
  is_billable                 BOOLEAN NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE change_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_classifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_change_classifications ON change_classifications
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT ON change_classifications TO app_user;
GRANT SELECT, INSERT ON change_classifications TO job_worker;

-- ============================================================
-- Project Outcomes (Operational Intelligence Context)
-- 案件の実績データ。見積精度キャリブレーションの元データ。
-- ============================================================
CREATE TABLE project_outcomes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id           UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  estimate_id       UUID REFERENCES estimates(id),
  actual_hours      NUMERIC NOT NULL,
  actual_cost       NUMERIC,
  deviation_percent NUMERIC,
  notes             TEXT,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id)
);

CREATE INDEX idx_project_outcomes_tenant ON project_outcomes(tenant_id);

ALTER TABLE project_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_outcomes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_project_outcomes ON project_outcomes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON project_outcomes TO app_user;
GRANT SELECT, INSERT, UPDATE ON project_outcomes TO job_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON project_outcomes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Outbox Events (ADR-0009)
-- ============================================================
CREATE TABLE outbox_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type        TEXT NOT NULL,
  aggregate_type    TEXT NOT NULL,
  aggregate_id      UUID NOT NULL,
  aggregate_version INTEGER NOT NULL DEFAULT 1,
  idempotency_key   UUID NOT NULL UNIQUE,
  correlation_id    UUID,
  causation_id      UUID,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  producer          TEXT NOT NULL,
  payload           JSONB NOT NULL,
  published         BOOLEAN NOT NULL DEFAULT false,
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_unpublished ON outbox_events(published, created_at) WHERE NOT published;
CREATE INDEX idx_outbox_tenant ON outbox_events(tenant_id, event_type);

-- outbox は RLS 対象外（ADR-0007 例外: publisher は tenant_id に関係なく
-- unpublished イベントをバッチ読み出しする必要がある）
-- app_user は同一トランザクションで INSERT するだけで、読み出しと公開更新は行わない
-- job_worker が BYPASSRLS なしでも outbox を読めるように GRANT する
GRANT INSERT ON outbox_events TO app_user;
GRANT SELECT, UPDATE ON outbox_events TO job_worker;

-- ============================================================
-- Processed Events (ADR-0009: consumer-side deduplication)
-- ============================================================
CREATE TABLE processed_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consumer_name   TEXT NOT NULL,
  event_id        UUID NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consumer_name, event_id)
);

GRANT SELECT, INSERT ON processed_events TO job_worker;

CREATE INDEX idx_processed_events_age ON processed_events(processed_at);

-- ============================================================
-- Inbound Webhook Receipts (ADR-0009)
-- ============================================================
CREATE TABLE inbound_webhook_receipts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID,
  provider              TEXT NOT NULL,
  delivery_id           TEXT NOT NULL,
  payload_sha256        TEXT NOT NULL,
  signature_verified_at TIMESTAMPTZ,
  first_received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  process_status        TEXT NOT NULL DEFAULT 'received'
                          CHECK (process_status IN ('received', 'processing', 'processed', 'failed', 'skipped')),
  replay_count          INTEGER NOT NULL DEFAULT 0,
  raw_payload_ref       TEXT,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, delivery_id)
);

CREATE INDEX idx_webhook_receipts_provider ON inbound_webhook_receipts(provider, process_status);

ALTER TABLE inbound_webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_webhook_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY app_select_webhook_receipts ON inbound_webhook_receipts
  FOR SELECT TO app_user
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY app_insert_webhook_receipts ON inbound_webhook_receipts
  FOR INSERT TO app_user
  WITH CHECK (true);

CREATE POLICY app_update_webhook_receipts ON inbound_webhook_receipts
  FOR UPDATE TO app_user
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY worker_all_webhook_receipts ON inbound_webhook_receipts
  FOR ALL TO job_worker
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON inbound_webhook_receipts TO app_user;
GRANT SELECT, INSERT, UPDATE ON inbound_webhook_receipts TO job_worker;

-- ============================================================
-- Pricing Policies (Admin)
-- ============================================================
CREATE TABLE pricing_policies (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_type                       TEXT NOT NULL,
  name                            TEXT NOT NULL,
  coefficient_min                 NUMERIC NOT NULL,
  coefficient_max                 NUMERIC NOT NULL,
  default_coefficient             NUMERIC NOT NULL,
  minimum_project_fee             NUMERIC NOT NULL DEFAULT 0,
  minimum_margin_percent          NUMERIC NOT NULL DEFAULT 20,
  avg_internal_cost_per_member_month NUMERIC,
  default_team_size               INTEGER,
  default_duration_months         INTEGER,
  active                          BOOLEAN NOT NULL DEFAULT true,
  created_by_uid                  TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pricing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pricing_policies ON pricing_policies
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON pricing_policies TO app_user;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON pricing_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Data Sources (Admin)
-- ============================================================
CREATE TABLE data_sources (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_key              TEXT NOT NULL,
  provider                TEXT NOT NULL,
  source_type             TEXT NOT NULL CHECK (source_type IN ('search', 'public_stats', 'internal', 'manual')),
  display_name            TEXT NOT NULL,
  description             TEXT,
  trust_level             INTEGER NOT NULL CHECK (trust_level BETWEEN 1 AND 5),
  freshness_ttl_hours     INTEGER NOT NULL DEFAULT 24,
  active                  BOOLEAN NOT NULL DEFAULT true,
  metadata                JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_key)
);

ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_data_sources ON data_sources
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON data_sources TO app_user;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON data_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- API Usage Logs (Operational Intelligence)
-- ============================================================
CREATE TABLE api_usage_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provider        TEXT NOT NULL,
  source_key      TEXT,
  endpoint        TEXT,
  model           TEXT,
  request_status  TEXT NOT NULL CHECK (request_status IN ('success', 'error', 'blocked')),
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  total_tokens    INTEGER,
  estimated_cost  NUMERIC NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  case_id         UUID REFERENCES cases(id) ON DELETE SET NULL,
  actor_uid       TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_usage_tenant ON api_usage_logs(tenant_id, created_at);
CREATE INDEX idx_api_usage_provider ON api_usage_logs(tenant_id, provider, created_at);

ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_api_usage_logs ON api_usage_logs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT ON api_usage_logs TO app_user;
GRANT SELECT, INSERT ON api_usage_logs TO job_worker;

-- ============================================================
-- Audit Logs (ADR-0010)
-- ============================================================
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID,
  actor_uid   TEXT NOT NULL,
  action      TEXT NOT NULL,
  resource    TEXT NOT NULL,
  resource_id UUID,
  details     JSONB NOT NULL DEFAULT '{}',
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id, created_at);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_uid, created_at);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- maintenance_admin は BYPASSRLS によりクロステナントで読める
GRANT SELECT, INSERT ON audit_logs TO app_user;
GRANT INSERT ON audit_logs TO job_worker;
GRANT SELECT ON audit_logs TO maintenance_admin;

-- ============================================================
-- GitHub Installations (Repository Intelligence Context)
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
-- Repositories (Repository Intelligence Context)
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
-- Velocity Metrics (Repository Intelligence Context, append-only)
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
-- maintenance_admin: 全テーブルアクセス（BYPASSRLS + 全権限）
-- マイグレーション、監査、データ修正に使用
-- ============================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO maintenance_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO maintenance_admin;
