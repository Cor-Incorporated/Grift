# The Benevolent Dictator - 実装計画書 v3.0

## 概要

複数顧客の依頼（新規開発・バグ報告・修正依頼・機能追加）を AI 執事が一問一答で完璧な仕様書に磨き上げ、案件タイプに応じて「反論不能の見積り」または「工数見積り」を自動生成し、Linear.app で開発タスクを管理する高効率案件管理システム。

---

## 案件タイプと対応フロー

本システムは 4 つの案件タイプを扱い、タイプごとに対話・見積りロジックが分岐する。

| タイプ | 説明 | 対話の焦点 | 見積り方式 |
| --- | --- | --- | --- |
| `new_project` | 新規開発 | 要件の網羅的ヒアリング | 市場比較見積り（工数 + 市場対比レポート + 価格エンジン） |
| `bug_report` | 既存システムのバグ報告 | 再現手順・環境・影響範囲の特定 | **工数見積りのみ**（金額なし — 保証/契約範囲） |
| `fix_request` | 既存機能の修正依頼 | 現状 vs 期待動作の差分明確化 | **工数見積りのみ**（金額なし — 保証/契約範囲） |
| `feature_addition` | 既存システムへの機能追加 | 既存アーキテクチャとの整合性確認 | ハイブリッド（工数ベース + 市場比較） |

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | Next.js 16 (App Router, React 19) + shadcn/ui + Tailwind CSS v4 |
| Backend | Supabase (PostgreSQL + RLS + Storage) |
| Auth | Clerk (`@clerk/nextjs`) with RBAC |
| AI (対話・解析) | Claude (Anthropic SDK) |
| AI (市場調査) | xAI Grok API (raw fetch) |
| Task Management | Linear SDK (`@linear/sdk`) |
| GitHub | GitHub App (Multi-Org) + REST API |
| Hosting | Vercel (Frontend) + Supabase (Backend) |
| Testing | Vitest + Testing Library + Playwright |
| Validation | Zod |

---

## Sprint 完了状況

### Sprint 0-6: 完了済み

| Sprint | 内容 | 状態 |
|--------|------|------|
| Sprint 0 | 基盤構築（Next.js, Supabase, Clerk, ESLint, Vitest） | ✅ 完了 |
| Sprint 1 | AI 執事 対話エンジン（タイプ別分岐、SSE ストリーミング） | ✅ 完了 |
| Sprint 2 | ファイル解析エンジン（PDF, 画像, ZIP 解析） | ✅ 完了 |
| Sprint 3 | GitHub 連携（App, Velocity分析, リポジトリ同期） | ✅ 完了 |
| Sprint 4 | Grok 市場調査（エビデンス取得、フォールバック） | ✅ 完了 |
| Sprint 5 | 見積りエンジン（3モード対応、Go/No-Go、承認ゲート） | ✅ 完了 |
| Sprint 6 | 管理者ダッシュボード（Realtime、対話ログ閲覧） | ✅ 完了 |

### Sprint N7 Day 1: デモ準備 + プロダクション強化（現在）

#### 完了タスク

**Team A: バグ報告見積り改革**
- [x] `auto-generate.ts` — bug_report/fix_request で `calculatePrice()` スキップ
- [x] `go-no-go.ts` — profitability ウェイト動的化（bug: 0, new: 0.35）
- [x] `system-prompts.ts` — バグ vs 機能追加の分類精度強化
- [x] `estimate-actions.tsx` — 工数のみUIの条件付きレンダリング
- [x] `projects/[id]/page.tsx` — 顧客向けバグ表示の簡素化
- [x] `estimates/route.ts` — API側pricing スキップ
- [x] テスト: auto-generate, go-no-go, classification-accuracy

**Team B: Linear 連携**
- [x] `supabase/migrations/202602160002_linear_integration.sql`
- [x] `src/lib/linear/client.ts` — SDK クライアント（Teams, Projects, Cycles, Issues）
- [x] `src/lib/linear/sync.ts` — 見積り→Linear 同期ロジック
- [x] `src/lib/linear/webhooks.ts` — HMAC-SHA256 署名検証
- [x] `src/app/api/linear/webhooks/route.ts` — Webhook エンドポイント
- [x] `src/app/api/admin/linear/sync/route.ts` — 手動同期 API
- [x] `src/app/api/admin/linear/teams/route.ts` — チーム一覧 API
- [x] Linear 同期ウィジェット（`linear-sync-widget.tsx`）
- [x] テスト: client, sync, webhooks

**プロダクション強化（HIGH 項目）**
- [x] 全36 APIエンドポイントにレート制限追加 (`rate-limit-config.ts`)
- [x] CSP / HSTS / セキュリティヘッダー (`next.config.ts`)
- [x] ヘルスチェック エンドポイント (`GET /api/health`)
- [x] 構造化ログ (`src/lib/utils/logger.ts`)
- [x] 環境変数バリデーション (`src/lib/utils/env.ts`)

#### 検証結果
- TypeScript: 0 errors
- ESLint: 0 errors, 0 warnings
- Vitest: 331 passed, 44 skipped
- Production build: 成功

---

## 残課題（MEDIUM / LOW）

| 優先度 | 項目 | 状態 |
|--------|------|------|
| MEDIUM | `estimates/route.ts` と `auto-generate.ts` のコード重複解消 | 未着手 |
| MEDIUM | Linear webhook リトライ / DLQ 機構 | 未着手 |
| MEDIUM | メール通知（見積完了通知等） | 未着手 |
| LOW | API バージョニング | 未着手 |
| LOW | モニタリング / アラート基盤 | 未着手 |
| LOW | キャッシュ戦略（Redis等） | 未着手 |
| LOW | i18n / a11y 対応 | 未着手 |

---

## 環境変数

`.env.example` を `.env.local` にコピーして設定。詳細は `CLAUDE.md` 参照。

| 変数グループ | 必須 | 取得元 |
|-------------|------|--------|
| Supabase | ✅ | Supabase ダッシュボード > Settings > API |
| Clerk | ✅ | https://dashboard.clerk.com |
| Anthropic | ✅ | https://console.anthropic.com/settings/keys |
| xAI | 推奨 | https://console.x.ai/ |
| GitHub App | 任意 | https://github.com/settings/apps |
| Linear | 任意 | https://linear.app/settings/api |
