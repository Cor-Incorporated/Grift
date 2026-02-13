# BenevolentDirector

非構造な依頼文（Slack風の雑多な指示を含む）を、要件化・見積り・着手パケットまで変換する Next.js アプリです。  
現在は **ダッシュボード完結型MVP** として運用しています。

## 現在の公開判定（2026-02-13）

- 登壇デモ用途: **GO（条件付き）**
- 一般公開（本番運用）: **未完了項目あり**

条件付き GO の条件:

1. `/admin/intake` で「3ケースを一括起票」を実行
2. 「登壇デモ準備ゲート」が `READY` 表示になること
3. CI の `quality-gate` が green であること

補足:

- 直近 PR: [#14](https://github.com/Cor-Incorporated/BenevolentDirector/pull/14)
- 状態監査: `docs/plans/demo-readiness-audit-2026-02-13.md`

## MVPスコープ（固定）

- 入力チャネル: Web ダッシュボード
- 連携スコープ外: Slack 自動連携、Stripe 決済連携
- 目的: 依頼の要件化と、エンジニア着手までの時間短縮

## 実装済み機能

1. 自由文からの意図分解と分割起票
2. 要件充足率（completeness）判定と不足質問生成
3. `needs_info` / `ready_to_start` キュー運用
4. 変更要求ごとの Ready Packet 表示
5. 概算見積り（一括実行含む）と失敗履歴
6. 実行タスク化、担当者アサイン、進捗イベント記録
7. 登壇用デモランナー（3ケース一括起票、履歴、成否判定）
8. 添付解析入力（ZIP/PDF/画像、Repository URL）
9. Admin RBAC（`/admin` は admin ロールのみ）
10. 監査ログ（主要アクション）

## 未完了・制約

1. E2E は現状ホーム画面スモーク中心（業務フローE2Eは不足）
2. 顧客向け PDF 出力や差分見積り提出フォーマットは未完成
3. dependency-review はフラグ制御で現在は `skipping`
4. Slack など外部チャネル取り込みは未実装（仕様上スコープ外）

## セットアップ

### 前提

- Node.js 20.x
- npm
- Supabase プロジェクト
- Clerk プロジェクト

### 1. 環境変数

`.env.example` を元に `.env.local` を作成し、最低限以下を設定してください。

- Supabase:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Clerk:
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`（ダミー不可）
  - `CLERK_SECRET_KEY`
  - `ADMIN_EMAIL_ALLOWLIST`（例: `company@cor-jp.com`）
- AI:
  - `ANTHROPIC_API_KEY`
  - `XAI_API_KEY`

### 2. 依存関係

```bash
npm ci
```

### 3. DBマイグレーション

`supabase/migrations` の SQL を適用してください。  
このリポジトリでは migration runner を同梱していないため、次のいずれかで適用します。

1. Supabase CLI (`supabase db push`)
2. Supabase SQL Editor で順次実行

### 4. 起動

```bash
npm run dev
```

`http://localhost:3000`

## 登壇デモ手順（最短）

1. admin 権限ユーザーでログイン
2. `/admin/intake` を開く
3. 対象案件を選択
4. 「3ケースを一括起票」を実行
5. 「登壇デモ準備ゲート」が `READY` になったことを確認
6. キューから `ready_to_start` を開き、Ready Packet を提示
7. 必要なら概算見積りを実行し、次アクションまで表示

添付解析デモを入れる場合:

1. 顧客チャット画面で ZIP/PDF/画像を添付、または Repository URL を入力
2. 管理画面の案件詳細で解析結果を確認

## テスト

```bash
npm run lint
npm run type-check
npm run test
npm run test:e2e
```

## CI/CD

### CI (`.github/workflows/ci.yml`)

- lint
- type-check
- unit-tests (coverage)
- migration-check
- build
- e2e-smoke
- dependency-review（フラグ有効時）
- quality-gate（最終判定）

### CD (`.github/workflows/cd.yml`)

- `main` push 時にビルド
- Vercel シークレットが揃っている場合のみ自動デプロイ

## 主要ルート

- 顧客:
  - `/`
  - `/dashboard`
  - `/projects/new`
- 管理:
  - `/admin`
  - `/admin/intake`
  - `/admin/execution-tasks`
  - `/admin/approvals`
  - `/admin/projects`
  - `/admin/estimates`
  - `/admin/pricing`

## APIハイライト

- Intake:
  - `POST /api/intake/parse`
  - `POST /api/intake/ingest`
  - `POST /api/intake/follow-up`
  - `POST /api/intake/demo-run`
- Change Request:
  - `POST /api/change-requests/:id/estimate`
  - `GET /api/change-requests/:id/ready-packet`
  - `POST /api/change-requests/:id/taskize`
- Attachments / Source Analysis:
  - `POST /api/files`
  - `POST /api/source-analysis/repository`
  - `POST /api/source-analysis/jobs/run`

## 関連ドキュメント

- `docs/plans/sprint-n5-mvp-dashboard-only-2026-02-13.md`
- `docs/plans/sprint-n6-day4-2026-02-13.md`
- `docs/plans/sprint-n7-day1-2026-02-13.md`
- `docs/plans/demo-readiness-audit-2026-02-13.md`
