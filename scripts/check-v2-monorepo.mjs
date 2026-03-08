#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const requiredFiles = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'v1/README.md',
  'v1/vercel.json',
  'docs/v2/README.md',
  'docs/v2/architecture-overview.md',
  'docs/v2/platform-bootstrap.md',
  'docs/v2/qwen35-poc-acceptance-criteria.md',
  'docs/v2/testing-strategy.md',
  'packages/contracts/openapi.yaml',
  'packages/contracts/initial-schema.sql',
  'packages/contracts/README.md',
  'packages/domain-events/README.md',
  'packages/config/README.md',
  'apps/web/README.md',
  'apps/web/package.json',
  'services/control-api/README.md',
  'services/control-api/go.mod',
  'services/intelligence-worker/README.md',
  'services/intelligence-worker/pyproject.toml',
  'services/llm-gateway/README.md',
  'services/llm-gateway/pyproject.toml',
  'infra/terraform/README.md',
  'infra/terraform/environments/dev/README.md',
  'infra/terraform/environments/staging/README.md',
  'infra/terraform/environments/prod/README.md',
]

const failures = []

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(process.cwd(), relativePath)
  if (!fs.existsSync(absolutePath)) {
    failures.push(`Missing required v2 scaffold file: ${relativePath}`)
  }
}

const rootReadme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8')
for (const snippet of [
  'docs/v2',
  'packages/contracts',
  'apps/web',
  'services/control-api',
  'mise run dev',
  'cd v1 && npm run dev',
]) {
  if (!rootReadme.includes(snippet)) {
    failures.push(`README.md must mention ${snippet}`)
  }
}

const v2Readme = fs.readFileSync(path.join(process.cwd(), 'docs/v2/README.md'), 'utf8')
for (const snippet of [
  'platform-bootstrap.md',
  'qwen35-poc-acceptance-criteria.md',
]) {
  if (!v2Readme.includes(snippet)) {
    failures.push(`docs/v2/README.md must reference ${snippet}`)
  }
}

if (failures.length > 0) {
  console.error('v2 monorepo readiness checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

const rootTsconfig = fs.readFileSync(path.join(process.cwd(), 'tsconfig.json'), 'utf8')
for (const staleSnippet of ['"name": "next"', 'next-env.d.ts', '.next/types/**/*.ts']) {
  if (rootTsconfig.includes(staleSnippet)) {
    failures.push(`root tsconfig.json must not contain stale Next.js config: ${staleSnippet}`)
  }
}

for (const stalePath of ['.next', 'next-env.d.ts', 'tsconfig.tsbuildinfo', 'vercel.json']) {
  if (fs.existsSync(path.join(process.cwd(), stalePath))) {
    failures.push(`Root monorepo hygiene violation: remove ${stalePath} from repo root`)
  }
}

const claude = fs.readFileSync(path.join(process.cwd(), 'CLAUDE.md'), 'utf8')
for (const snippet of [
  'monorepo',
  'v1/                     # v1 Next.js app',
  'apps/web/               # v2 React frontend',
  'mise run dev',
]) {
  if (!claude.includes(snippet)) {
    failures.push(`CLAUDE.md must mention ${snippet}`)
  }
}

if (failures.length > 0) {
  console.error('v2 monorepo readiness checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`v2 monorepo readiness checks passed (${requiredFiles.length} files + root hygiene verified)`)
