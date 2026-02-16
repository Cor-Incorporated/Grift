#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()

if (files.length === 0) {
  console.error('No migration files found in supabase/migrations')
  process.exit(1)
}

const seenPrefixes = new Set()
let hasError = false

for (const file of files) {
  const match = file.match(/^(\d{12})_[a-z0-9_]+\.sql$/)
  if (!match) {
    console.error(`Invalid migration filename format: ${file}`)
    hasError = true
    continue
  }

  const prefix = match[1]
  if (seenPrefixes.has(prefix)) {
    console.error(`Duplicate migration prefix detected: ${prefix}`)
    hasError = true
  }
  seenPrefixes.add(prefix)

  const fullPath = path.join(migrationsDir, file)
  const content = fs.readFileSync(fullPath, 'utf8').trim()
  if (content.length === 0) {
    console.error(`Empty migration file: ${file}`)
    hasError = true
    continue
  }

  const ddlPattern = /\b(create|alter|drop|insert|update|delete)\b/i
  if (!ddlPattern.test(content)) {
    console.error(`Migration does not appear to contain SQL statements: ${file}`)
    hasError = true
  }
}

if (hasError) {
  process.exit(1)
}

console.log(`Migration check passed (${files.length} files)`)
