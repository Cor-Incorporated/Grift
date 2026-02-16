// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { estimateHoursWithClaude } from '@/lib/estimates/hours-estimator'

/**
 * Live API test for estimateHoursWithClaude.
 * Verifies that the real Claude API response is correctly parsed
 * (JSON + ---BREAKDOWN--- delimiter separation).
 *
 * Run with: ANTHROPIC_API_KEY=xxx npx vitest run src/__tests__/live/hours-estimator-live.test.ts
 */
describe.runIf(!!process.env.ANTHROPIC_API_KEY)(
  'estimateHoursWithClaude - Live API',
  () => {
    it('new_project: large spec with complex requirements parses correctly', async () => {
      // This spec intentionally triggers Markdown tables and nested lists
      // in the breakdown — the exact scenario that caused ca37ee3d failure
      const spec = `# ホームページ制作プロジェクト 要件定義書

## 1. プロジェクト概要
企業のコーポレートサイトを新規制作する。レスポンシブデザイン、多言語対応（日本語・英語）、
CMS機能付きで、マーケティングチームが自分でコンテンツ更新できること。

## 2. ターゲットユーザー
- BtoBの潜在顧客（製造業、IT業界）
- 採用候補者
- 既存パートナー企業

## 3. 機能要件
### 3.1 フロントエンド
- トップページ（ヒーローセクション、実績カルーセル、ニュースフィード）
- サービス紹介ページ（6サービス × 個別LP）
- 事例紹介（フィルタリング、タグ検索）
- ブログ/ニュース（カテゴリ、ページネーション、OGP自動生成）
- お問い合わせフォーム（バリデーション、reCAPTCHA、Slack通知）
- 採用ページ（職種一覧、応募フォーム）
- 会社概要・アクセスマップ（Google Maps埋め込み）

### 3.2 管理画面（CMS）
- 記事のCRUD操作
- 画像アップロード（最適化、WebP変換）
- SEOメタ情報の編集
- プレビュー機能
- 公開/下書き管理
- アクセス解析ダッシュボード（GA4連携）

### 3.3 インフラ
- Vercelへのデプロイ
- CDN設定（画像・静的ファイル）
- カスタムドメイン設定
- SSL/TLS
- 自動バックアップ

## 4. 技術要件
- Next.js 15 (App Router, RSC)
- TypeScript strict mode
- Tailwind CSS v4
- Supabase (PostgreSQL + Storage)
- Clerk認証
- Vercel hosting
- Playwright E2Eテスト

## 5. 非機能要件
- LCP < 2.5秒
- アクセシビリティ WCAG 2.1 AA
- 月間10万PV対応
- 稼働率99.9%

## 6. スケジュール
- デザイン: 1ヶ月
- 開発: 2.5ヶ月
- テスト: 0.5ヶ月
- 合計: 4ヶ月

## 7. 予算
3,000,000円〜5,000,000円`

      const result = await estimateHoursWithClaude(spec, 'new_project')

      // JSON parse succeeded (this is the critical assertion)
      expect(result.total).toBeGreaterThan(0)
      expect(result.investigation).toBeGreaterThan(0)
      expect(result.implementation).toBeGreaterThan(0)
      expect(result.testing).toBeGreaterThan(0)
      expect(result.buffer).toBeGreaterThan(0)

      // Total should be consistent
      const componentSum = result.investigation + result.implementation + result.testing + result.buffer
      expect(Math.abs(result.total - componentSum)).toBeLessThanOrEqual(1)

      // Breakdown should be extracted (from ---BREAKDOWN--- or fallback)
      expect(result.breakdown.length).toBeGreaterThan(10)

      console.log('=== Live API Result ===')
      console.log(`Investigation: ${result.investigation}h`)
      console.log(`Implementation: ${result.implementation}h`)
      console.log(`Testing: ${result.testing}h`)
      console.log(`Buffer: ${result.buffer}h`)
      console.log(`Total: ${result.total}h`)
      console.log(`Breakdown length: ${result.breakdown.length} chars`)
      console.log(`Breakdown preview: ${result.breakdown.slice(0, 200)}...`)
    }, 120_000)

    it('bug_report: simpler spec also parses correctly', async () => {
      const spec = `# バグレポート: ログインページでのセッションタイムアウトエラー

## バグ概要
ログイン後5分で自動的にセッションが切れ、操作中にエラーページにリダイレクトされる。

## 影響度: 高
全ユーザーに影響。業務が中断される。

## 再現手順
1. ログインページでメールアドレスとパスワードを入力
2. ログインボタンをクリック
3. ダッシュボードが表示される
4. 5分間操作を続ける
5. 突然エラーページにリダイレクトされる

## 発生環境
- Chrome 120, Safari 17
- 本番環境のみ（開発環境では再現しない）

## 推定原因
セッションリフレッシュのAPIエンドポイントが本番環境でCORSエラーを返している可能性。`

      const result = await estimateHoursWithClaude(spec, 'bug_report')

      expect(result.total).toBeGreaterThan(0)
      expect(result.investigation).toBeGreaterThan(0)
      expect(result.implementation).toBeGreaterThan(0)
      expect(result.breakdown.length).toBeGreaterThan(10)

      console.log('=== Bug Report Result ===')
      console.log(`Total: ${result.total}h`)
      console.log(`Breakdown preview: ${result.breakdown.slice(0, 200)}...`)
    }, 120_000)
  }
)
