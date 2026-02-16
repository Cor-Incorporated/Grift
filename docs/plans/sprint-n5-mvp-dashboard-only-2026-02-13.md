# Sprint N+5 P0 Plan (Dashboard Only MVP) / 2026-02-13

## スコープ前提
- Slack/外部チャット連携: **今回スコープ外**
- Stripe/課金連携: **今回スコープ外**
- 入力チャネル: **Webダッシュボードのみ**
- 目的: 非構造依頼をダッシュボード内で要件化し、概算付きでエンジニア着手可能状態にする

## P0ゴール
1. PM/営業が自由文を投入すると、意図分解されて複数の変更要求へ自動起票される
2. `needs_info` と `ready_to_start` が明確に分離され、不足項目を埋める運用ができる
3. `ready_to_start` は概算見積と根拠を持つ「着手パケット」として確認できる
4. すべて管理ダッシュボード上で完結する

## P0チケット（実行順）

### P0-1 Admin Intake Workspace
- Type: Story
- Summary: 管理画面から自由文入力→解析プレビュー→一括起票を実行可能にする
- AC:
  - `/admin/intake` で `project + free text` を入力できる
  - `/api/intake/parse` の結果をUIで確認できる
  - `/api/intake/ingest` で複数change requestが作成される

### P0-2 Intake Queue Dashboard
- Type: Story
- Summary: `needs_info / ready_to_start` を可視化し、優先度付きで扱える
- AC:
  - `needs_info / ready_to_start / all` のタブで一覧切替できる
  - 各項目で completeness と missing fields が見える
  - 不足質問を1クリックで生成できる

### P0-3 Ready Packet API + UI
- Type: Story
- Summary: 変更要求ごとにエンジニア着手パケットを生成・閲覧可能にする
- AC:
  - `GET /api/change-requests/:id/ready-packet` を実装
  - UIからパケットを開いて、概要/不足情報/概算/次アクションを確認できる

### P0-4 Dashboard UX Upgrade
- Type: Story
- Summary: Adminトップを運用中心UIに刷新し、次アクションを明確化する
- AC:
  - Intake未充足数・着手可能数がカードで可視化される
  - `Intake Workspace` への導線が常設される

### P0-5 Quality Gate (Minimal)
- Type: Task
- Summary: MVP変更点に対する回帰を担保する
- AC:
  - `lint`, `type-check`, `test` がgreen
  - `test:e2e`（既存smoke）がgreen

## スプリント内優先順
1. P0-1
2. P0-2
3. P0-3
4. P0-4
5. P0-5

## スコープ外（明示）
- Slack DM取り込み
- 外部ワークスペース連携（Teams/メール自動収集）
- Stripe請求/決済
- 高度な自動優先度学習
