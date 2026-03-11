#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const schemaPath = path.join(process.cwd(), 'packages/contracts/initial-schema.sql')
const content = fs.readFileSync(schemaPath, 'utf8')
const failures = []

function expectRegex(regex, message) {
  if (!regex.test(content)) {
    failures.push(message)
  }
}

function expectNoRegex(regex, message) {
  if (regex.test(content)) {
    failures.push(message)
  }
}

const tenantScopedTables = [
  'tenant_members',
  'cases',
  'conversation_turns',
  'qa_pairs',
  'source_documents',
  'document_chunks',
  'chunk_embeddings',
  'requirement_artifacts',
  'repository_snapshots',
  'evidence_fragments',
  'aggregated_evidences',
  'estimates',
  'proposal_sessions',
  'approval_decisions',
  'handoff_packages',
  'handoff_issue_mappings',
  'change_classifications',
  'project_outcomes',
  'inbound_webhook_receipts',
  'pricing_policies',
  'data_sources',
  'api_usage_logs',
  'audit_logs',
]

for (const table of tenantScopedTables) {
  expectRegex(
    new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`),
    `${table} must ENABLE ROW LEVEL SECURITY`
  )
  expectRegex(
    new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`),
    `${table} must FORCE ROW LEVEL SECURITY`
  )
}

expectRegex(
  /CREATE ROLE maintenance_admin NOLOGIN BYPASSRLS;/,
  'maintenance_admin must keep BYPASSRLS'
)
expectRegex(
  /GRANT SELECT, INSERT ON conversation_turns TO app_user;/,
  'conversation_turns must be append-only for app_user'
)
expectRegex(
  /GRANT SELECT, INSERT ON conversation_turns TO job_worker;/,
  'conversation_turns must be append-only for job_worker'
)
expectRegex(
  /GRANT SELECT, INSERT ON qa_pairs TO app_user;/,
  'qa_pairs must be append-only for app_user'
)
expectRegex(
  /GRANT SELECT, INSERT ON qa_pairs TO job_worker;/,
  'qa_pairs must be append-only for job_worker'
)
expectNoRegex(
  /GRANT [^\n]*UPDATE[^\n]*ON conversation_turns TO app_user;/,
  'conversation_turns must not grant UPDATE to app_user'
)
expectNoRegex(
  /GRANT [^\n]*DELETE[^\n]*ON conversation_turns TO app_user;/,
  'conversation_turns must not grant DELETE to app_user'
)
expectNoRegex(
  /GRANT [^\n]*UPDATE[^\n]*ON conversation_turns TO job_worker;/,
  'conversation_turns must not grant UPDATE to job_worker'
)
expectNoRegex(
  /GRANT [^\n]*DELETE[^\n]*ON conversation_turns TO job_worker;/,
  'conversation_turns must not grant DELETE to job_worker'
)
expectNoRegex(
  /GRANT [^\n]*UPDATE[^\n]*ON qa_pairs TO app_user;/,
  'qa_pairs must not grant UPDATE to app_user'
)
expectNoRegex(
  /GRANT [^\n]*DELETE[^\n]*ON qa_pairs TO app_user;/,
  'qa_pairs must not grant DELETE to app_user'
)
expectNoRegex(
  /GRANT [^\n]*UPDATE[^\n]*ON qa_pairs TO job_worker;/,
  'qa_pairs must not grant UPDATE to job_worker'
)
expectNoRegex(
  /GRANT [^\n]*DELETE[^\n]*ON qa_pairs TO job_worker;/,
  'qa_pairs must not grant DELETE to job_worker'
)

expectRegex(
  /tenant_id\s+UUID NOT NULL REFERENCES tenants\(id\) ON DELETE RESTRICT,/,
  'outbox_events.tenant_id must have a tenant FK with ON DELETE RESTRICT'
)
expectRegex(
  /GRANT INSERT ON outbox_events TO app_user;/,
  'outbox_events must allow INSERT for app_user'
)
expectRegex(
  /GRANT SELECT, UPDATE ON outbox_events TO job_worker;/,
  'outbox_events must allow SELECT, UPDATE for job_worker'
)
expectNoRegex(
  /GRANT [^\n]*SELECT[^\n]*ON outbox_events TO app_user;/,
  'outbox_events must not grant SELECT to app_user'
)
expectNoRegex(
  /GRANT [^\n]*UPDATE[^\n]*ON outbox_events TO app_user;/,
  'outbox_events must not grant UPDATE to app_user'
)
expectNoRegex(
  /GRANT [^\n]*ON processed_events TO app_user;/,
  'processed_events must not grant access to app_user'
)

for (const policy of [
  'app_select_webhook_receipts',
  'app_insert_webhook_receipts',
  'app_update_webhook_receipts',
  'worker_all_webhook_receipts',
  'tenant_isolation_audit_logs',
]) {
  expectRegex(new RegExp(`CREATE POLICY ${policy} `), `Missing RLS policy: ${policy}`)
}

expectRegex(
  /GRANT SELECT, INSERT ON audit_logs TO app_user;/,
  'audit_logs must allow tenant-scoped SELECT, INSERT for app_user'
)
expectRegex(
  /GRANT SELECT ON audit_logs TO maintenance_admin;/,
  'audit_logs must allow maintenance_admin SELECT'
)

// ADR-0012 / ADR-0013: opt-in columns on tenants table
expectRegex(
  /analytics_opt_in\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i,
  'tenants must have analytics_opt_in BOOLEAN NOT NULL DEFAULT FALSE (ADR-0012)'
)
expectRegex(
  /training_opt_in\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i,
  'tenants must have training_opt_in BOOLEAN NOT NULL DEFAULT FALSE (ADR-0013)'
)

if (failures.length > 0) {
  console.error('v2 schema checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`v2 schema checks passed (${tenantScopedTables.length} tenant-scoped tables checked)`)
