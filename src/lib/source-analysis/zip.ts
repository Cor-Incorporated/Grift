import { inflateRawSync } from 'node:zlib'
import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import type { UsageCallContext } from '@/lib/usage/api-usage'

const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50

const MAX_SUPPORTED_ZIP_BYTES = 25 * 1024 * 1024
const MAX_SUPPORTED_ENTRIES = 3000
const MAX_SAMPLE_FILES = 20
const MAX_SAMPLE_CHARS_PER_FILE = 5000
const MAX_SAMPLE_CHARS_TOTAL = 60000
const MAX_EXTRACTED_TEXT_BYTES = 300 * 1024

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.php',
  '.sh',
  '.dockerfile',
  '.env',
])

const IMPORTANT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'go.mod',
  'cargo.toml',
  'pom.xml',
  'build.gradle',
  'gemfile',
  'composer.json',
  'readme.md',
  'dockerfile',
  'docker-compose.yml',
]

interface ZipEntry {
  fileName: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
  generalPurposeBitFlag: number
  localHeaderOffset: number
  isDirectory: boolean
}

export interface ZipSampledFile {
  path: string
  uncompressedBytes: number
  excerpt: string
}

export interface ZipSnapshot {
  totalEntries: number
  totalFiles: number
  totalUncompressedBytes: number
  topDirectories: string[]
  sampledFiles: ZipSampledFile[]
  sampledChars: number
}

interface RawZipAnalysis {
  summary?: unknown
  system_type?: unknown
  tech_stack?: unknown
  architecture?: unknown
  key_modules?: unknown
  risks?: unknown
  change_impact_points?: unknown
  recommended_questions?: unknown
}

interface ZipAnalysisModule {
  path: string
  purpose: string
}

export interface ZipAnalysisResult {
  summary: string
  systemType: string
  techStack: string[]
  architecture: string[]
  keyModules: ZipAnalysisModule[]
  risks: string[]
  changeImpactPoints: string[]
  recommendedQuestions: string[]
  snapshot: ZipSnapshot
}

function getExtension(path: string): string {
  const lowered = path.toLowerCase()
  const dot = lowered.lastIndexOf('.')
  if (dot === -1) {
    if (lowered.endsWith('dockerfile')) return '.dockerfile'
    return ''
  }
  return lowered.slice(dot)
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\/+/, '')
}

function isLikelyTextPath(path: string): boolean {
  const normalized = normalizePath(path)
  if (normalized.startsWith('__MACOSX/')) return false
  if (normalized.includes('/.git/')) return false
  if (normalized.includes('/node_modules/')) return false
  if (normalized.includes('/dist/')) return false
  if (normalized.includes('/build/')) return false
  if (normalized.includes('/coverage/')) return false

  const fileName = normalized.split('/').at(-1)?.toLowerCase() ?? ''
  if (IMPORTANT_FILES.includes(fileName)) return true
  return TEXT_EXTENSIONS.has(getExtension(normalized))
}

function isLikelyTextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return true
  const sampleLength = Math.min(buffer.length, 2048)
  let suspicious = 0
  for (let i = 0; i < sampleLength; i += 1) {
    const byte = buffer[i]
    if (byte === 0) return false
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1
  }
  return suspicious / sampleLength < 0.12
}

function findEndOfCentralDirectoryOffset(archiveBuffer: Buffer): number {
  const minOffset = Math.max(0, archiveBuffer.length - 0xffff - 22)
  for (let offset = archiveBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (archiveBuffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset
    }
  }
  throw new Error('ZIP の終端ヘッダが見つかりません')
}

function parseZipEntries(archiveBuffer: Buffer): ZipEntry[] {
  if (archiveBuffer.length > MAX_SUPPORTED_ZIP_BYTES) {
    throw new Error('ZIP サイズが上限を超えています')
  }

  const eocdOffset = findEndOfCentralDirectoryOffset(archiveBuffer)
  const totalEntries = archiveBuffer.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = archiveBuffer.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = archiveBuffer.readUInt32LE(eocdOffset + 16)

  if (totalEntries === 0xffff || centralDirectoryOffset === 0xffffffff || centralDirectorySize === 0xffffffff) {
    throw new Error('Zip64 形式は未対応です')
  }

  if (totalEntries > MAX_SUPPORTED_ENTRIES) {
    throw new Error('ZIP 内ファイル数が上限を超えています')
  }

  if (centralDirectoryOffset + centralDirectorySize > archiveBuffer.length) {
    throw new Error('ZIP 中央ディレクトリの範囲が不正です')
  }

  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset

  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > archiveBuffer.length) {
      throw new Error('ZIP 中央ディレクトリの読み取りに失敗しました')
    }
    const signature = archiveBuffer.readUInt32LE(offset)
    if (signature !== ZIP_CENTRAL_FILE_SIGNATURE) {
      throw new Error('ZIP 中央ディレクトリの署名が不正です')
    }

    const generalPurposeBitFlag = archiveBuffer.readUInt16LE(offset + 8)
    const compressionMethod = archiveBuffer.readUInt16LE(offset + 10)
    const compressedSize = archiveBuffer.readUInt32LE(offset + 20)
    const uncompressedSize = archiveBuffer.readUInt32LE(offset + 24)
    const fileNameLength = archiveBuffer.readUInt16LE(offset + 28)
    const extraFieldLength = archiveBuffer.readUInt16LE(offset + 30)
    const fileCommentLength = archiveBuffer.readUInt16LE(offset + 32)
    const localHeaderOffset = archiveBuffer.readUInt32LE(offset + 42)

    const fileNameStart = offset + 46
    const fileNameEnd = fileNameStart + fileNameLength
    if (fileNameEnd > archiveBuffer.length) {
      throw new Error('ZIP エントリ名の読み取りに失敗しました')
    }

    const fileName = normalizePath(
      archiveBuffer.subarray(fileNameStart, fileNameEnd).toString(
        (generalPurposeBitFlag & 0x800) !== 0 ? 'utf8' : 'utf8'
      )
    )

    entries.push({
      fileName,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      generalPurposeBitFlag,
      localHeaderOffset,
      isDirectory: fileName.endsWith('/'),
    })

    offset = fileNameEnd + extraFieldLength + fileCommentLength
  }

  return entries
}

function extractEntryBytes(archiveBuffer: Buffer, entry: ZipEntry): Buffer | null {
  if (entry.uncompressedSize > MAX_EXTRACTED_TEXT_BYTES) {
    return null
  }

  if (entry.localHeaderOffset + 30 > archiveBuffer.length) {
    return null
  }

  const signature = archiveBuffer.readUInt32LE(entry.localHeaderOffset)
  if (signature !== ZIP_LOCAL_FILE_SIGNATURE) {
    return null
  }

  const fileNameLength = archiveBuffer.readUInt16LE(entry.localHeaderOffset + 26)
  const extraFieldLength = archiveBuffer.readUInt16LE(entry.localHeaderOffset + 28)
  const dataOffset = entry.localHeaderOffset + 30 + fileNameLength + extraFieldLength
  const dataEnd = dataOffset + entry.compressedSize

  if (dataEnd > archiveBuffer.length) {
    return null
  }

  const compressed = archiveBuffer.subarray(dataOffset, dataEnd)

  try {
    if (entry.compressionMethod === 0) {
      return compressed
    }
    if (entry.compressionMethod === 8) {
      return inflateRawSync(compressed)
    }
    return null
  } catch {
    return null
  }
}

function scorePath(path: string): number {
  const normalized = path.toLowerCase()
  const fileName = normalized.split('/').at(-1) ?? normalized

  if (IMPORTANT_FILES.includes(fileName)) return 100
  if (normalized.includes('/src/')) return 70
  if (normalized.includes('/app/')) return 65
  if (normalized.includes('/api/')) return 60
  if (normalized.includes('/components/')) return 55
  if (normalized.includes('/lib/')) return 50
  return 20
}

function extractTopDirectories(entries: ZipEntry[]): string[] {
  const counts = new Map<string, number>()

  for (const entry of entries) {
    if (entry.isDirectory) continue
    const firstSegment = entry.fileName.split('/').find(Boolean) ?? '(root)'
    counts.set(firstSegment, (counts.get(firstSegment) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => `${name}(${count})`)
}

function toTextArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, limit)
}

function toKeyModules(value: unknown): ZipAnalysisModule[] {
  if (!Array.isArray(value)) return []
  const modules: ZipAnalysisModule[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const path = typeof item.path === 'string' ? item.path.trim() : ''
    const purpose = typeof item.purpose === 'string' ? item.purpose.trim() : ''
    if (!path || !purpose) continue
    modules.push({ path, purpose })
  }

  return modules.slice(0, 10)
}

function inferTechStackFromPaths(paths: string[]): string[] {
  const stack = new Set<string>()
  for (const path of paths) {
    const lowered = path.toLowerCase()
    if (lowered.endsWith('package.json') || lowered.endsWith('.ts') || lowered.endsWith('.tsx')) {
      stack.add('TypeScript/Node.js')
    }
    if (lowered.includes('next.config') || lowered.includes('/app/') || lowered.includes('/pages/')) {
      stack.add('Next.js')
    }
    if (lowered.endsWith('.py') || lowered.endsWith('requirements.txt') || lowered.endsWith('pyproject.toml')) {
      stack.add('Python')
    }
    if (lowered.endsWith('go.mod') || lowered.endsWith('.go')) {
      stack.add('Go')
    }
    if (lowered.endsWith('cargo.toml') || lowered.endsWith('.rs')) {
      stack.add('Rust')
    }
    if (lowered.endsWith('pom.xml') || lowered.endsWith('.java')) {
      stack.add('Java')
    }
    if (lowered.endsWith('dockerfile') || lowered.endsWith('docker-compose.yml')) {
      stack.add('Docker')
    }
  }
  return [...stack]
}

export function buildZipSnapshot(archiveBuffer: Buffer): ZipSnapshot {
  const entries = parseZipEntries(archiveBuffer)
  const files = entries.filter((entry) => !entry.isDirectory)
  const topDirectories = extractTopDirectories(files)

  const candidates = files
    .filter((entry) => isLikelyTextPath(entry.fileName))
    .sort((a, b) => scorePath(b.fileName) - scorePath(a.fileName))

  let sampledChars = 0
  const sampledFiles: ZipSampledFile[] = []

  for (const entry of candidates) {
    if (sampledFiles.length >= MAX_SAMPLE_FILES) break
    if (sampledChars >= MAX_SAMPLE_CHARS_TOTAL) break

    const bytes = extractEntryBytes(archiveBuffer, entry)
    if (!bytes || !isLikelyTextBuffer(bytes)) continue

    const excerpt = bytes.toString('utf8').slice(0, MAX_SAMPLE_CHARS_PER_FILE)
    if (!excerpt.trim()) continue

    sampledChars += excerpt.length
    sampledFiles.push({
      path: entry.fileName,
      uncompressedBytes: entry.uncompressedSize,
      excerpt,
    })
  }

  const totalUncompressedBytes = files.reduce((sum, item) => sum + item.uncompressedSize, 0)

  return {
    totalEntries: entries.length,
    totalFiles: files.length,
    totalUncompressedBytes,
    topDirectories,
    sampledFiles,
    sampledChars,
  }
}

function buildFallbackAnalysis(snapshot: ZipSnapshot): ZipAnalysisResult {
  const inferredStack = inferTechStackFromPaths(snapshot.sampledFiles.map((file) => file.path))
  const summary = `ZIP内の${snapshot.totalFiles}ファイルを解析しました。主要ディレクトリは ${snapshot.topDirectories.join(', ') || '不明'} です。`

  return {
    summary,
    systemType: '不明',
    techStack: inferredStack,
    architecture: [],
    keyModules: snapshot.sampledFiles.slice(0, 6).map((file) => ({
      path: file.path,
      purpose: '主要ソース候補',
    })),
    risks: [],
    changeImpactPoints: [],
    recommendedQuestions: [],
    snapshot,
  }
}

export async function analyzeZipArchiveWithClaude(input: {
  archiveName: string
  archiveBuffer: Buffer
  usageContext?: UsageCallContext
}): Promise<ZipAnalysisResult> {
  const snapshot = buildZipSnapshot(input.archiveBuffer)
  const fallback = buildFallbackAnalysis(snapshot)

  if (snapshot.sampledFiles.length === 0) {
    return {
      ...fallback,
      summary: `${fallback.summary} テキスト解析可能なソースが見つからなかったため、構成推定は限定的です。`,
    }
  }

  const sampleBlocks = snapshot.sampledFiles
    .map(
      (file) =>
        `### ${file.path} (${file.uncompressedBytes} bytes)\n` +
        '```text\n' +
        `${file.excerpt}\n` +
        '```'
    )
    .join('\n\n')

  const prompt = `次のZIPアーカイブ内容を解析し、必ずJSONのみで返してください。

アーカイブ名: ${input.archiveName}
総エントリ数: ${snapshot.totalEntries}
総ファイル数: ${snapshot.totalFiles}
総非圧縮サイズ: ${snapshot.totalUncompressedBytes}
主要ディレクトリ: ${snapshot.topDirectories.join(', ') || '(none)'}

出力形式:
\`\`\`json
{
  "summary": "システム概要（2-4文）",
  "system_type": "例: Webアプリ/SaaS/バッチ",
  "tech_stack": ["..."],
  "architecture": ["..."],
  "key_modules": [
    { "path": "src/...", "purpose": "役割" }
  ],
  "risks": ["..."],
  "change_impact_points": ["..."],
  "recommended_questions": ["..."]
}
\`\`\`

制約:
- 断定できない内容は「推定」と明記
- key_modules は最大10件
- 日本語で返答

解析対象サンプル:
${sampleBlocks}`

  try {
    const responseText = await sendMessage(
      'あなたは受託開発案件の技術分析官です。構成と変更影響を簡潔かつ正確に整理してください。',
      [{ role: 'user', content: prompt }],
      {
        maxTokens: 1800,
        temperature: 0.1,
        usageContext: input.usageContext,
      }
    )

    const parsed = parseJsonFromResponse<RawZipAnalysis>(responseText)

    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : fallback.summary

    return {
      summary,
      systemType:
        typeof parsed.system_type === 'string' && parsed.system_type.trim().length > 0
          ? parsed.system_type.trim()
          : fallback.systemType,
      techStack: toTextArray(parsed.tech_stack, 12),
      architecture: toTextArray(parsed.architecture, 12),
      keyModules: toKeyModules(parsed.key_modules),
      risks: toTextArray(parsed.risks, 12),
      changeImpactPoints: toTextArray(parsed.change_impact_points, 12),
      recommendedQuestions: toTextArray(parsed.recommended_questions, 12),
      snapshot,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    return {
      ...fallback,
      summary: `${fallback.summary} Claude解析でエラーが発生したため、基本情報のみ返却しました。(${message})`,
    }
  }
}
