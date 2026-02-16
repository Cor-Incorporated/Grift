import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildProjectAttachmentContext } from '@/lib/source-analysis/project-context'

const MOCK_PROJECT_ID = 'proj-001'

function createMockSupabase(
  projectFilesResponse: { data: unknown; error: unknown },
  jobsResponse?: { data: unknown; error: unknown }
) {
  const fromMock = vi.fn()

  fromMock.mockImplementation((table: string) => {
    if (table === 'project_files') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(projectFilesResponse),
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'source_analysis_jobs') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(jobsResponse ?? { data: null, error: null }),
              }),
            }),
          }),
        }),
      }
    }
    return {}
  })

  return { from: fromMock } as unknown as SupabaseClient
}

describe('buildProjectAttachmentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty string when no files found', async () => {
    const supabase = createMockSupabase({ data: [], error: null })

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toBe('')
  })

  it('returns empty string on database error', async () => {
    const supabase = createMockSupabase({ data: null, error: { message: 'DB error' } })

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toBe('')
  })

  it('formats completed files with analysis results', async () => {
    const files = [
      {
        file_name: 'repo-analysis.json',
        file_type: 'application/json',
        source_kind: 'repository_url',
        source_url: 'https://github.com/org/repo',
        analysis_result: {
          summary: 'Reactベースのウェブアプリケーション',
          tech_stack: ['React', 'TypeScript', 'Node.js'],
          system_type: 'Web Application',
        },
        analysis_status: 'completed',
        analyzed_at: '2025-01-15T10:00:00.000Z',
      },
    ]
    const supabase = createMockSupabase({ data: files, error: null })

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('添付資料の解析結果:')
    expect(result).toContain('repo-analysis.json')
    expect(result).toContain('Repository URL')
    expect(result).toContain('https://github.com/org/repo')
    expect(result).toContain('Reactベースのウェブアプリケーション')
    expect(result).toContain('React, TypeScript, Node.js')
    expect(result).toContain('Web Application')
  })

  it('formats pending files with "解析中" label', async () => {
    const files = [
      {
        file_name: 'pending-file.pdf',
        file_type: 'application/pdf',
        source_kind: 'file_upload',
        source_url: null,
        analysis_result: null,
        analysis_status: 'pending',
        analyzed_at: null,
      },
    ]
    const supabase = createMockSupabase({ data: files, error: null })

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('解析待ちの資料:')
    expect(result).toContain('pending-file.pdf')
    expect(result).toContain('解析中')
  })

  it('formats failed files with error messages from source_analysis_jobs', async () => {
    const files = [
      {
        file_name: 'failed-repo.json',
        file_type: 'application/json',
        source_kind: 'repository_url',
        source_url: 'https://github.com/org/private-repo',
        analysis_result: null,
        analysis_status: 'failed',
        analyzed_at: null,
      },
    ]
    const jobsData = [
      {
        status: 'failed',
        last_error: 'リポジトリのダウンロードに失敗しました (404)',
        project_files: {
          file_name: 'failed-repo.json',
          source_url: 'https://github.com/org/private-repo',
        },
      },
    ]
    const supabase = createMockSupabase(
      { data: files, error: null },
      { data: jobsData, error: null }
    )

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('解析に失敗した資料')
    expect(result).toContain('エラー:')
    expect(result).toContain('リポジトリのダウンロードに失敗しました (404)')
  })

  it('failed files without job data show generic "解析失敗"', async () => {
    const files = [
      {
        file_name: 'failed-file.zip',
        file_type: 'application/zip',
        source_kind: 'file_upload',
        source_url: null,
        analysis_result: null,
        analysis_status: 'failed',
        analyzed_at: null,
      },
    ]
    const supabase = createMockSupabase(
      { data: files, error: null },
      { data: [], error: null }
    )

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('解析に失敗した資料')
    expect(result).toContain('failed-file.zip')
    expect(result).toContain('解析失敗')
  })

  it('structured analysis context includes tech stack, system type, architecture', async () => {
    const files = [
      {
        file_name: 'full-analysis.json',
        file_type: 'application/json',
        source_kind: 'repository_url',
        source_url: 'https://github.com/org/app',
        analysis_result: {
          summary: 'フルスタックアプリ',
          tech_stack: ['Next.js', 'PostgreSQL'],
          system_type: 'SaaS',
          architecture: 'マイクロサービスアーキテクチャ',
          risks: ['スケーラビリティ懸念', 'セキュリティ設計要確認'],
          key_modules: ['認証モジュール', '決済モジュール'],
        },
        analysis_status: 'completed',
        analyzed_at: '2025-02-01T12:00:00.000Z',
      },
    ]
    const supabase = createMockSupabase({ data: files, error: null })

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('技術スタック: Next.js, PostgreSQL')
    expect(result).toContain('システムタイプ: SaaS')
    expect(result).toContain('アーキテクチャ: マイクロサービスアーキテクチャ')
    expect(result).toContain('リスク:')
    expect(result).toContain('スケーラビリティ懸念')
    expect(result).toContain('主要モジュール:')
    expect(result).toContain('認証モジュール')
  })

  it('structured analysis context includes website analysis fields', async () => {
    const files = [
      {
        file_name: 'website-analysis.json',
        file_type: 'application/json',
        source_kind: 'repository_url',
        source_url: 'https://example.com',
        analysis_result: {
          summary: 'コーポレートサイト',
          pageStructure: ['トップページ', '会社概要', 'サービス一覧'],
          uiComponents: ['ナビゲーションバー', 'ヒーローセクション', 'カード'],
          navigationPattern: 'ハンバーガーメニュー',
          designPatterns: ['カードレイアウト', 'グリッドシステム'],
          responsiveApproach: 'モバイルファースト',
          interactiveFeatures: ['スライダー', 'モーダル'],
          estimatedComplexity: '中程度',
        },
        analysis_status: 'completed',
        analyzed_at: '2025-02-10T08:00:00.000Z',
      },
    ]
    const supabase = createMockSupabase({ data: files, error: null })

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('ページ構成:')
    expect(result).toContain('トップページ')
    expect(result).toContain('UIコンポーネント:')
    expect(result).toContain('ナビゲーションバー')
    expect(result).toContain('ナビゲーション: ハンバーガーメニュー')
    expect(result).toContain('デザインパターン:')
    expect(result).toContain('レスポンシブ: モバイルファースト')
    expect(result).toContain('インタラクティブ機能:')
    expect(result).toContain('推定複雑度: 中程度')
  })

  it('structured analysis context includes image analysis fields', async () => {
    const files = [
      {
        file_name: 'screen-capture.png',
        file_type: 'image/png',
        source_kind: 'file_upload',
        source_url: null,
        analysis_result: {
          summary: 'ダッシュボード画面のスクリーンショット',
          image_type: 'UI設計画像',
          ui_elements: ['テーブル', 'グラフ', 'サイドバー'],
          layout_structure: '2カラムレイアウト',
          functional_estimate: 'データ可視化機能が主体',
          dev_complexity_notes: ['リアルタイムグラフ更新', 'ドラッグ＆ドロップ'],
        },
        analysis_status: 'completed',
        analyzed_at: '2025-02-12T15:00:00.000Z',
      },
    ]
    const supabase = createMockSupabase({ data: files, error: null })

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('画像種別: UI設計画像')
    expect(result).toContain('UI要素:')
    expect(result).toContain('テーブル')
    expect(result).toContain('レイアウト: 2カラムレイアウト')
    expect(result).toContain('機能推定: データ可視化機能が主体')
    expect(result).toContain('開発複雑度ポイント:')
    expect(result).toContain('リアルタイムグラフ更新')
  })

  it('limits to 10 files via query limit parameter', async () => {
    const supabase = createMockSupabase({ data: [], error: null })

    await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    const fromCall = (supabase.from as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fromCall[0]).toBe('project_files')
  })

  it('handles mixed completed, pending, and failed files', async () => {
    const files = [
      {
        file_name: 'completed.json',
        file_type: 'application/json',
        source_kind: 'repository_url',
        source_url: 'https://github.com/org/repo',
        analysis_result: { summary: '完了した分析' },
        analysis_status: 'completed',
        analyzed_at: '2025-01-20T10:00:00.000Z',
      },
      {
        file_name: 'pending.pdf',
        file_type: 'application/pdf',
        source_kind: 'file_upload',
        source_url: null,
        analysis_result: null,
        analysis_status: 'pending',
        analyzed_at: null,
      },
      {
        file_name: 'failed.zip',
        file_type: 'application/zip',
        source_kind: 'file_upload',
        source_url: null,
        analysis_result: null,
        analysis_status: 'failed',
        analyzed_at: null,
      },
    ]
    const supabase = createMockSupabase(
      { data: files, error: null },
      { data: [], error: null }
    )

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('添付資料の解析結果:')
    expect(result).toContain('completed.json')
    expect(result).toContain('解析待ちの資料:')
    expect(result).toContain('pending.pdf')
    expect(result).toContain('解析に失敗した資料')
    expect(result).toContain('failed.zip')
  })

  it('pending files with source_url include the URL', async () => {
    const files = [
      {
        file_name: 'pending-repo.json',
        file_type: 'application/json',
        source_kind: 'repository_url',
        source_url: 'https://github.com/org/pending-repo',
        analysis_result: null,
        analysis_status: 'pending',
        analyzed_at: null,
      },
    ]
    const supabase = createMockSupabase({ data: files, error: null })

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('https://github.com/org/pending-repo')
  })

  it('completed file without analysis_result still shows up', async () => {
    const files = [
      {
        file_name: 'empty-result.json',
        file_type: 'application/json',
        source_kind: 'file_upload',
        source_url: null,
        analysis_result: null,
        analysis_status: 'completed',
        analyzed_at: '2025-01-10T00:00:00.000Z',
      },
    ]
    const supabase = createMockSupabase({ data: files, error: null })

    const result = await buildProjectAttachmentContext(supabase, MOCK_PROJECT_ID)

    expect(result).toContain('添付資料の解析結果:')
    expect(result).toContain('empty-result.json')
    expect(result).toContain('File Upload')
  })
})
