import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv from 'ajv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const schemaDir = path.join(__dirname, 'schemas')

function registerFormats(ajv) {
  ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/)
  ajv.addFormat('date-time', (value) => !Number.isNaN(Date.parse(value)))
  ajv.addFormat('uri', (value) => {
    try {
      new URL(value)
      return true
    } catch {
      return false
    }
  })
}

async function loadSchemas() {
  const files = (await readdir(schemaDir))
    .filter((file) => file.endsWith('.json'))
    .sort()

  const schemas = []

  for (const file of files) {
    const absolutePath = path.join(schemaDir, file)
    const raw = await readFile(absolutePath, 'utf8')
    const schema = JSON.parse(raw)
    schemas.push({ file, schema })
  }

  return schemas
}

async function main() {
  const loaded = await loadSchemas()
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateSchema: true,
  })

  registerFormats(ajv)

  for (const { schema } of loaded) {
    ajv.addSchema(schema, schema.$id)
  }

  let failures = 0

  for (const { file, schema } of loaded) {
    try {
      ajv.getSchema(schema.$id) ?? ajv.compile(schema)
      console.log(`ok ${file}`)
    } catch (error) {
      failures += 1
      console.error(`fail ${file}`)
      console.error(error instanceof Error ? error.message : String(error))
    }
  }

  if (failures > 0) {
    process.exitCode = 1
    return
  }

  const hasLegacyEnvelope = loaded.some(({ file }) => file === '_envelope.json')
  const hasDotEnvelope = loaded.some(({ file }) => file === '_envelope_v2.json')
  const dotNotationSchemas = loaded.filter(({ file }) =>
    /^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+\.json$/.test(file)
  )
  const pascalCaseSchemas = loaded.filter(({ file }) =>
    /^[A-Z][A-Za-z0-9]+\.json$/.test(file)
  )

  if (!hasLegacyEnvelope || !hasDotEnvelope) {
    console.error('Both legacy (_envelope.json) and dot-notation (_envelope_v2.json) envelopes are required')
    process.exitCode = 1
    return
  }

  if (dotNotationSchemas.length === 0 || pascalCaseSchemas.length === 0) {
    console.error('Both PascalCase and dot.notation event schema families must coexist')
    process.exitCode = 1
    return
  }

  console.log(
    `Validated ${loaded.length} schema files in ${schemaDir} ` +
    `(legacy=${pascalCaseSchemas.length}, dot=${dotNotationSchemas.length})`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
