// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { sendMessage } from '@/lib/ai/anthropic'
import { getSpecGenerationPrompt } from '@/lib/ai/system-prompts'

async function generateSpec(
  projectType: 'new_project' | 'bug_report' | 'fix_request' | 'feature_addition',
  conversationText: string
): Promise<string> {
  const specPrompt = getSpecGenerationPrompt(projectType)
  return await sendMessage(specPrompt, [
    {
      role: 'user',
      content: `以下の対話記録を基に文書を生成してください:\n\n${conversationText}`,
    },
  ], { temperature: 0.3, maxTokens: 4096 })
}

describe.runIf(!!process.env.ANTHROPIC_API_KEY)('Spec Quality - Live API', () => {
  it('New Project Spec - Has All Required Sections', async () => {
    const conversation = [
      'user: Next.jsを使ったBtoB SaaSプラットフォームを新規開発したいです。',
      'user: ターゲットは中小企業の人事部門で、勤怠管理と給与計算を自動化したいです。',
      'user: 機能としては、タイムカード打刻、残業申請、有給管理、給与計算連携、CSV出力が必要です。',
      'user: 技術的にはNext.js、TypeScript、PostgreSQL、Tailwind CSSを使いたいです。',
      'user: デザインはモダンで、モバイル対応必須です。Figmaでデザインカンプは用意します。',
      'user: スケジュールは6ヶ月、予算は2000万円くらいを想定しています。',
      'user: 非機能要件としては、同時100人のアクセスに耐えられること、99.9%のSLAが必要です。',
      'user: 既存の給与計算ソフト（弥生給与）とAPIで連携したいです。',
      'user: 成功指標は、導入後6ヶ月で人事業務の工数を50%削減することです。',
      'user: AIやIoTは不要です。運用保守は1年間お願いしたいです。',
      'user: 過去に別の会社にWebシステムを発注した際は約1500万円でした。',
    ].join('\n')

    const spec = await generateSpec('new_project', conversation)

    expect(spec).toMatch(/概要|プロジェクト概要/)
    expect(spec).toMatch(/機能|機能要件/)
    expect(spec).toMatch(/タイムカード|勤怠/)
    expect(spec).toMatch(/技術|技術要件/)
    expect(spec).toMatch(/スケジュール|期間|プロジェクト期間|タイムライン|納期/)
    expect(spec).toMatch(/非機能要件/)
    expect(spec).toMatch(/連携|API/)
    expect(spec.length).toBeGreaterThan(500)
    expect(spec).toMatch(/PostgreSQL|Next\.js/)
  }, 120_000)

  it('Bug Report Spec - Actionable for Developer', async () => {
    const conversation = [
      'user: ログイン画面でメールアドレスを入力してログインボタンを押すと、画面が真っ白になります。',
      'user: Chrome 120 on macOS Sonoma 14.3で発生。Firefox 121では正常に動作します。',
      'user: 再現手順：1. /login にアクセス 2. メールアドレスとパスワードを入力 3. ログインボタンをクリック 4. 画面が白くなる',
      'user: コンソールにTypeError: Cannot read properties of undefined (reading \'token\')と出ています。',
      'user: 先週木曜日のデプロイ(commit: abc123)以降から発生しています。',
      'user: 社内の50人全員が影響を受けていて、業務が止まっています。',
      'user: 緊急度は最高です。すぐに直してほしいです。',
    ].join('\n')

    const spec = await generateSpec('bug_report', conversation)

    expect(spec).toMatch(/再現手順/)
    expect(spec).toMatch(/TypeError/)
    expect(spec).toMatch(/Chrome.*Firefox|Firefox.*Chrome|ブラウザ/)
    expect(spec).toMatch(/影響|影響範囲/)
    expect(spec).toMatch(/緊急/)
    expect(spec.length).toBeGreaterThan(200)
    expect(spec).not.toMatch(/新機能|機能追加/)
  }, 60000)

  it('Feature Addition Spec - Differentiates From New Project', async () => {
    const conversation = [
      'user: 既存のReact+Node.jsのERPシステムに、レポート自動生成機能を追加したいです。',
      'user: 現在、月次レポートは手動でExcelで作成しています。これをAIで自動化したいです。',
      'user: 具体的には、売上データ・在庫データ・顧客データからAIが分析レポートを生成します。',
      'user: 生成されたレポートはPDFでダウンロードでき、Slackにも自動通知したいです。',
      'user: 既存のREST APIを拡張して、新しいエンドポイントを3つ追加する予定です。',
      'user: データモデルはreportsテーブルとreport_templatesテーブルの追加が必要です。',
      'user: 2ヶ月で実装してほしいです。予算は200万円くらいです。',
      'user: テスト条件としては、レポート生成精度90%以上が必須です。',
    ].join('\n')

    const spec = await generateSpec('feature_addition', conversation)

    expect(spec).toMatch(/既存システム|既存/)
    expect(spec).toMatch(/追加|機能追加/)
    expect(spec).toMatch(/API/)
    expect(spec).toMatch(/データモデル|テーブル/)
    expect(spec).toMatch(/テスト|検証|受け入れ基準|品質|精度/)
    expect(spec.length).toBeGreaterThan(300)
    expect(spec).not.toMatch(/画面一覧.*データモデル（概要）/)
  }, 120_000)

  it('Fix Request Spec - Before/After Clarity', async () => {
    const conversation = [
      'user: 商品検索機能の修正をお願いしたいです。',
      'user: 現在、商品名で検索すると部分一致しかできません。',
      'user: 修正後は、商品名だけでなく、商品コード・カテゴリでも検索できるようにしてください。',
      'user: 修正理由は、お客様から「探しにくい」というクレームが多いためです。',
      'user: 影響範囲は検索画面と検索API（/api/products/search）です。',
      'user: 優先度は中です。今月中に対応してもらえれば大丈夫です。',
      'user: 関連チケットは JIRA-1234 です。',
      'user: テスト条件は、商品コード検索で正確に1件ヒットすること、カテゴリ検索で該当商品がすべて表示されることです。',
    ].join('\n')

    const spec = await generateSpec('fix_request', conversation)

    expect(spec).toMatch(/現在の動作|Before/)
    expect(spec).toMatch(/修正後|After/)
    expect(spec).toMatch(/影響範囲/)
    expect(spec).toMatch(/テスト/)
    expect(spec).toMatch(/\/api\/products\/search|検索API/)
    expect(spec).toMatch(/JIRA/)
    expect(spec.length).toBeGreaterThan(200)
  }, 60000)

  it('Ambiguous Input - Should Flag Uncertainties', async () => {
    const conversation = [
      'user: 何かいい感じのアプリを作りたいです。',
      'user: SNSみたいなやつです。詳しいことはまだ決まっていません。',
      'user: 予算はなるべく安く。納期は早ければ早いほどいいです。',
      'user: 技術的なことはよくわかりません。おまかせします。',
    ].join('\n')

    const spec = await generateSpec('new_project', conversation)

    expect(spec).toMatch(/\[要確認\]|不明|未定|要確認/)
    expect(spec.length).toBeLessThan(10000)
    expect(spec).toMatch(/^#|##/)
  }, 120_000)
})
