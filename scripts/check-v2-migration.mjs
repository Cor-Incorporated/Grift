#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const migrationsDir = path.join(process.cwd(), 'services/control-api/migrations')
const failures = []

if (!fs.existsSync(migrationsDir)) {
  console.error('migrations directory not found:', migrationsDir)
  process.exit(1)
}

const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

if (files.length === 0) {
  failures.push('No migration files found')
}

// Group by migration number
const migrations = new Map()
for (const file of files) {
  const match = file.match(/^(\d{6})_(.+)\.(up|down)\.sql$/)
  if (!match) {
    failures.push(`Invalid migration filename format: ${file} (expected NNNNNN_name.up.sql or NNNNNN_name.down.sql)`)
    continue
  }
  const [, num, name, direction] = match
  const key = `${num}_${name}`
  if (!migrations.has(key)) {
    migrations.set(key, { num, name, up: false, down: false })
  }
  migrations.get(key)[direction] = true
}

// Check sequential numbering
const numbers = [...migrations.values()].map(m => parseInt(m.num, 10)).sort((a, b) => a - b)
for (let i = 0; i < numbers.length; i++) {
  if (numbers[i] !== i + 1) {
    failures.push(`Migration numbering gap: expected ${String(i + 1).padStart(6, '0')}, got ${String(numbers[i]).padStart(6, '0')}`)
  }
}

// Check up/down pairs
for (const [key, m] of migrations) {
  if (!m.up) {
    failures.push(`Missing .up.sql for migration: ${key}`)
  }
  if (!m.down) {
    failures.push(`Missing .down.sql for migration: ${key}`)
  }
}

// Check files are not empty and have no dangerous statements
const dangerous = [
  { pattern: /DROP\s+DATABASE/i, message: 'DROP DATABASE' },
  { pattern: /TRUNCATE\s+/i, message: 'TRUNCATE statement' },
]

for (const file of files) {
  const filePath = path.join(migrationsDir, file)
  const content = fs.readFileSync(filePath, 'utf8').trim()

  if (content.length === 0) {
    failures.push(`Empty migration file: ${file}`)
    continue
  }

  // Only check .up.sql for dangerous statements (down files legitimately DROP things)
  if (file.endsWith('.up.sql')) {
    for (const { pattern, message } of dangerous) {
      if (pattern.test(content)) {
        failures.push(`Dangerous statement in ${file}: ${message}`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error('v2 migration checks failed:')
  for (const f of failures) {
    console.error(`  - ${f}`)
  }
  process.exit(1)
}

console.log(`v2 migration checks passed (${migrations.size} migration(s), ${files.length} files)`)
