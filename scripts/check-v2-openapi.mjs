#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const openapiPath = path.join(process.cwd(), 'packages/contracts/openapi.yaml')
const content = fs.readFileSync(openapiPath, 'utf8')
const failures = []

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getPathBlock(routePath) {
  const pattern = new RegExp(`^  ${escapeRegExp(routePath)}:\\n([\\s\\S]*?)(?=^  /|^components:)`, 'm')
  const match = content.match(pattern)
  return match ? match[0] : ''
}

function getSchemaBlock(name) {
  const pattern = new RegExp(`^    ${escapeRegExp(name)}:\\n([\\s\\S]*?)(?=^    [A-Za-z0-9_]+:|^\\S)`, 'm')
  const match = content.match(pattern)
  return match ? match[0] : ''
}

function expectIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    failures.push(message)
  }
}

function expectMissing(haystack, needle, message) {
  if (haystack.includes(needle)) {
    failures.push(message)
  }
}

try {
  execFileSync('ruby', ['-e', "require 'yaml'; YAML.load_file(ARGV[0])", openapiPath], {
    stdio: 'pipe',
  })
} catch (error) {
  failures.push(`openapi.yaml is not valid YAML: ${error.message}`)
}

for (const marker of [
  'tenantIdHeader:',
  'ErrorResponse:',
  'BadRequest:',
  'Unauthorized:',
  'Forbidden:',
  'NotFound:',
  'TooManyRequests:',
  '/v1/cases/{caseId}/requirement-artifact:',
  '/v1/operational/outcomes:',
  '/v1/operational/pricing-recommendations:',
]) {
  expectIncludes(content, marker, `Missing required OpenAPI marker: ${marker}`)
}

const allPaths = [...content.matchAll(/^  (\/[^\n]+):$/gm)].map((match) => match[1])
const systemScopedPaths = new Set([
  '/health',
  '/v1/tenants',
  '/v1/webhooks/linear',
  '/v1/webhooks/github',
])

for (const routePath of allPaths) {
  const block = getPathBlock(routePath)
  if (!block) {
    failures.push(`Unable to read OpenAPI block for ${routePath}`)
    continue
  }

  const hasTenantHeader = block.includes('#/components/parameters/tenantIdHeader')

  if (systemScopedPaths.has(routePath)) {
    if (routePath === '/v1/tenants') {
      expectIncludes(
        block,
        '#/components/responses/Unauthorized',
        `${routePath} must define Unauthorized response`
      )
    }
    expectMissing(
      block,
      '#/components/parameters/tenantIdHeader',
      `${routePath} must not require X-Tenant-ID`
    )
    continue
  }

  if (!hasTenantHeader) {
    failures.push(`${routePath} must require X-Tenant-ID`)
  }
}

const linearWebhookBlock = getPathBlock('/v1/webhooks/linear')
expectIncludes(
  linearWebhookBlock,
  'X-Linear-Signature',
  'Linear webhook must require X-Linear-Signature header'
)
expectIncludes(
  linearWebhookBlock,
  '"401":',
  'Linear webhook must define a 401 response'
)
expectIncludes(
  linearWebhookBlock,
  'requestBody:',
  'Linear webhook must define a requestBody'
)

const githubWebhookBlock = getPathBlock('/v1/webhooks/github')
expectIncludes(
  githubWebhookBlock,
  'X-Hub-Signature-256',
  'GitHub webhook must require X-Hub-Signature-256 header'
)
expectIncludes(
  githubWebhookBlock,
  '"401":',
  'GitHub webhook must define a 401 response'
)
expectIncludes(
  githubWebhookBlock,
  'requestBody:',
  'GitHub webhook must define a requestBody'
)

// ADR-0012 / ADR-0013: opt-in fields in Tenant schema
const tenantSchemaBlock = getSchemaBlock('Tenant')
expectIncludes(
  tenantSchemaBlock,
  'analytics_opt_in:',
  'Tenant schema must include analytics_opt_in field (ADR-0012)'
)
expectIncludes(
  tenantSchemaBlock,
  'training_opt_in:',
  'Tenant schema must include training_opt_in field (ADR-0013)'
)

// ADR-0012 / ADR-0013: settings update endpoint
expectIncludes(
  content,
  '/v1/tenants/{tenantId}/settings:',
  'Missing tenant settings endpoint for opt-in management (ADR-0012, ADR-0013)'
)
const settingsBlock = getPathBlock('/v1/tenants/{tenantId}/settings')
expectIncludes(
  settingsBlock,
  'UpdateTenantSettingsRequest',
  'Tenant settings endpoint must reference UpdateTenantSettingsRequest'
)

const handoffRequestBlock = getSchemaBlock('CreateHandoffRequest')
expectIncludes(
  handoffRequestBlock,
  'required: [estimate_id, idempotency_key]',
  'CreateHandoffRequest must require estimate_id and idempotency_key'
)
expectIncludes(
  handoffRequestBlock,
  'idempotency_key:',
  'CreateHandoffRequest must define idempotency_key'
)

if (failures.length > 0) {
  console.error('v2 OpenAPI checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`v2 OpenAPI checks passed (${allPaths.length} paths checked)`)
