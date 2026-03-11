#!/usr/bin/env node

/**
 * ADR 整合性チェック
 *
 * ADR で定義された制約が schema / OpenAPI / コードに反映されているか検証する。
 * AI 駆動開発で ADR からの逸脱を CI で検出するためのガードレール。
 */

import fs from 'node:fs'
import path from 'node:path'

const failures = []

function readFile(relativePath) {
  const fullPath = path.join(process.cwd(), relativePath)
  if (!fs.existsSync(fullPath)) {
    failures.push(`File not found: ${relativePath}`)
    return ''
  }
  return fs.readFileSync(fullPath, 'utf8')
}

function expectIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    failures.push(message)
  }
}

function expectRegex(content, regex, message) {
  if (!regex.test(content)) {
    failures.push(message)
  }
}

function expectNoRegex(content, regex, message) {
  if (regex.test(content)) {
    failures.push(message)
  }
}

const schema = readFile('packages/contracts/initial-schema.sql')
const openapi = readFile('packages/contracts/openapi.yaml')

// ============================================================
// ADR-0012: Cross-Tenant Anonymous Intelligence
// ============================================================

// opt-in が schema に存在する
expectRegex(
  schema,
  /analytics_opt_in\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i,
  'ADR-0012: analytics_opt_in must exist on tenants table with DEFAULT FALSE'
)

// opt-in が OpenAPI に存在する
expectIncludes(
  openapi,
  'analytics_opt_in:',
  'ADR-0012: Tenant schema in OpenAPI must include analytics_opt_in'
)

// settings endpoint が存在する
expectIncludes(
  openapi,
  '/v1/tenants/{tenantId}/settings:',
  'ADR-0012: Tenant settings endpoint must exist for opt-in management'
)

// ============================================================
// ADR-0013: Training Data Governance
// ============================================================

// training_opt_in が schema に存在する
expectRegex(
  schema,
  /training_opt_in\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i,
  'ADR-0013: training_opt_in must exist on tenants table with DEFAULT FALSE'
)

// training_opt_in が OpenAPI に存在する
expectIncludes(
  openapi,
  'training_opt_in:',
  'ADR-0013: Tenant schema in OpenAPI must include training_opt_in'
)

// ============================================================
// ADR-0009: Webhook idempotency
// ============================================================

// idempotency_key が handoff に含まれる
expectIncludes(
  openapi,
  'idempotency_key:',
  'ADR-0009: idempotency_key must be defined in OpenAPI schemas'
)

// inbound_webhook_receipts テーブルが存在する
expectIncludes(
  schema,
  'CREATE TABLE inbound_webhook_receipts',
  'ADR-0009: inbound_webhook_receipts table must exist'
)

// processed_events テーブルが存在する
expectIncludes(
  schema,
  'CREATE TABLE processed_events',
  'ADR-0009: processed_events table must exist for deduplication'
)

// ============================================================
// ADR-0008: Embedding (pgvector)
// ============================================================

// pgvector extension
expectIncludes(
  schema,
  'CREATE EXTENSION IF NOT EXISTS',
  'ADR-0008: pgvector extension must be enabled'
)

// chunk_embeddings テーブル
expectIncludes(
  schema,
  'CREATE TABLE chunk_embeddings',
  'ADR-0008: chunk_embeddings table must exist'
)

// ============================================================
// ADR-0014: NDJSON Streaming-First
// ============================================================

expectIncludes(
  openapi,
  'application/x-ndjson',
  'ADR-0014: streaming endpoint must use application/x-ndjson'
)
expectIncludes(
  openapi,
  'NDJSONStreamChunk:',
  'ADR-0014: NDJSON stream chunk schema must be defined'
)
expectIncludes(
  openapi,
  'xDataClassificationHeader:',
  'ADR-0014 W11: X-Data-Classification header parameter must be defined'
)
expectRegex(
  openapi,
  /enum:\s*\[public,\s*internal,\s*confidential,\s*restricted\]/,
  'ADR-0014 W11: X-Data-Classification enum must include public/internal/confidential/restricted'
)
expectRegex(
  openapi,
  /default:\s*restricted/,
  'ADR-0014 W11: X-Data-Classification default must be restricted (fail-closed)'
)
expectNoRegex(
  openapi,
  /text\/event-stream/,
  'ADR-0014: streaming endpoint must not use legacy text/event-stream'
)

// ============================================================
// Contract-first: schema と OpenAPI の基本整合性
// ============================================================

const schemaTableNames = [...schema.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1])

// テーブル数とパス数の比率チェック（大幅な乖離を検出）
const openapiPaths = [...openapi.matchAll(/^  (\/[^\n]+):$/gm)].map((m) => m[1])
if (openapiPaths.length < 10) {
  failures.push(
    `Contract-first: OpenAPI has only ${openapiPaths.length} paths — expected at least 10 for 7 bounded contexts`
  )
}
if (schemaTableNames.length < 15) {
  failures.push(
    `Contract-first: Schema has only ${schemaTableNames.length} tables — expected at least 15`
  )
}

// ============================================================
// Tenant isolation: RLS が全テナントテーブルに適用済み
// ============================================================

const tablesWithTenantId = [...schema.matchAll(/CREATE TABLE (\w+)\s*\([^;]*?tenant_id[^;]*?\);/gs)].map(
  (m) => m[1]
)
for (const table of tablesWithTenantId) {
  if (table === 'outbox_events') continue // outbox は特殊
  expectRegex(
    schema,
    new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`),
    `Tenant isolation: ${table} has tenant_id but missing ENABLE RLS`
  )
}

// ============================================================
// Results
// ============================================================

if (failures.length > 0) {
  console.error('v2 ADR consistency checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(
  `v2 ADR consistency checks passed (${schemaTableNames.length} tables, ${openapiPaths.length} paths)`
)
