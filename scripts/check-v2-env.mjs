#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const envFilePath = path.join(process.cwd(), '.env.local')
const fileEnv = {}

if (fs.existsSync(envFilePath)) {
  const raw = fs.readFileSync(envFilePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue
    }
    const separatorIndex = trimmed.indexOf('=')
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    fileEnv[key] = value.replace(/^['"]|['"]$/g, '')
  }
}

const env = new Proxy(
  {},
  {
    get(_target, property) {
      return fileEnv[property] ?? process.env[property]
    },
  }
)

const groups = {
  gcp: [
    'GOOGLE_CLOUD_PROJECT',
    'CLOUDSQL_CONNECTION_NAME',
    'CLOUDSQL_DB_USER',
    'CLOUDSQL_DB_PASSWORD',
    'CLOUDSQL_DB_NAME',
    'GCS_BUCKET_DOCUMENTS',
    'PUBSUB_PROJECT_ID',
  ],
  firebase: [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_SERVICE_ACCOUNT_KEY',
  ],
  external_ai: [
    'ANTHROPIC_API_KEY',
    'XAI_API_KEY',
    'BRAVE_SEARCH_API_KEY',
    'PERPLEXITY_API_KEY',
    'GEMINI_API_KEY',
  ],
  github: [
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_SECRET',
    'GITHUB_APP_WEBHOOK_SECRET',
  ],
  linear: [
    'LINEAR_API_KEY',
    'LINEAR_WEBHOOK_SECRET',
    'LINEAR_DEFAULT_TEAM_ID',
  ],
}

const placeholderPatterns = [
  /^changeme$/i,
  /^replace-with/i,
  /^your[-_]/i,
  /^example/i,
  /^test[-_]/i,
  /^dummy/i,
  /^base64-encoded/i,
]

const failures = []

for (const [groupName, keys] of Object.entries(groups)) {
  for (const key of keys) {
    const value = env[key]
    if (!value) {
      failures.push(`${groupName}: missing ${key}`)
      continue
    }

    if (placeholderPatterns.some((pattern) => pattern.test(value))) {
      failures.push(`${groupName}: ${key} still looks like a placeholder`)
    }
  }
}

if (failures.length > 0) {
  console.error('v2 environment checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

const source = fs.existsSync(envFilePath) ? '.env.local + process.env' : 'process.env'
console.log(`v2 environment checks passed (${source})`)
