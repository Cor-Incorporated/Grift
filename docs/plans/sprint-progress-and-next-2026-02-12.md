# BenevolentDirector: 実装進捗と次スプリント計画（更新版 / 2026-02-12）

## 1. 進捗サマリー（提示チケット31件基準）

判定ルール: `Done=1.0 / Partial=0.5 / Not Started=0.0`

| Epic | Stories | Done | Partial | Not Started | 進捗率 |
|---|---:|---:|---:|---:|---:|
| EPIC-REQ | 5 | 0 | 2 | 3 | 20% |
| EPIC-DATA | 10 | 3 | 3 | 4 | 45% |
| EPIC-PRICE | 4 | 4 | 0 | 0 | 100% |
| EPIC-CHG | 6 | 5 | 0 | 1 | 83% |
| EPIC-GOV | 2 | 1 | 1 | 0 | 75% |
| EPIC-OUT | 4 | 0 | 0 | 4 | 0% |
| **Total** | **31** | **13** | **6** | **12** | **52%** |

## 2. Story別更新ステータス

| Story ID | 状態 | 更新根拠（2026-02-12更新） |
|---|---|---|
| REQ-101 | Partial | 基本入力バリデーションあり。要件テンプレート強制UIは未完成 |
| REQ-102 | Not Started | 要件品質スコア未実装 |
| REQ-103 | Not Started | トレーサビリティ行列未実装 |
| REQ-104 | Partial | 監査ログは実装。手動補正理由の必須化は未完成 |
| REQ-105 | Not Started | 要件差分レビュー未実装 |
| DATA-101 | **Done** | `data_sources` テーブル + 管理API実装済み |
| DATA-102 | Not Started (再評価対象) | X API専用コネクタ未実装。現方針は xAI中心 |
| DATA-103 | **Done** | xAI Responses + `web_search`/`x_search` + citation保存実装 |
| DATA-104 | Not Started | BLS未実装 |
| DATA-105 | Not Started | e-Stat未実装 |
| DATA-106 | Not Started | OECD未実装 |
| DATA-107 | Partial | 市場根拠の正規化は実装。通貨/職種標準化は未完成 |
| DATA-108 | Partial | confidence score算出あり。一次情報比率の厳密評価は未完成 |
| DATA-109 | Partial | `api_usage_logs` 実装、xAI/Claude 呼び出しの usage 記録と hard quota ガードを導入。予兆通知は未実装 |
| DATA-110 | **Done** | Evidence Appendix を見積へ保存・表示し、2ソース未達時は `draft` 固定ガードを実装 |
| PRICE-101 | **Done** | 価格ポリシー版管理実装 |
| PRICE-102 | **Done** | 市場想定計算（人数×期間×単価）実装 |
| PRICE-103 | **Done** | 当社提示額算定/下限比較実装 |
| PRICE-104 | **Done** | 下限割れ・低粗利・高リスク差分で承認リクエスト自動起票、承認状態で見積確定可否を制御 |
| CHG-101 | **Done** | 変更要求受付API/UI実装 |
| CHG-102 | **Done** | 保証期間/責任区分/再現性のルールテーブル + API + UI入力 + 判定根拠保存を実装 |
| CHG-103 | **Done** | 追加工数4区分算定実装 |
| CHG-104 | **Done** | 追加料金算定実装 |
| CHG-105 | Partial | 変更見積り生成あり。顧客提出差分文書の完成度不足 |
| CHG-106 | **Done** | 承認リクエストに `required_role` を追加し、該当ロール（またはadmin）以外の承認操作を禁止 |
| GOV-101 | Partial | Admin/案件所有者検証あり。sales/dev/customerの多ロール未実装 |
| GOV-102 | **Done** | 主要mutationの監査アクションをテストで網羅検証し、CIゲート化 |
| OUT-101 | Not Started | 顧客向けPDF出力未実装 |
| OUT-102 | Not Started | 経営ダッシュボード未実装 |
| OUT-103 | Not Started | 通知未実装 |
| OUT-104 | Not Started | 学習ループ未実装 |

## 3. Day2残タスクの実装結果（今回）

### 3.1 完了
- 顧客チャットで ZIP/PDF/画像 添付、GitHub URL解析の受付UIを実装
- `project_files` を解析状態管理対応に拡張（`source_kind`, `analysis_status` など）
- 解析ジョブキュー `source_analysis_jobs` を新規実装
- キュー実行API `/api/source-analysis/jobs/run` を実装
- ZIP解析（ファイル構成抽出 + Claude要約）を実装
- PDF本文抽出（ヒューリスティック）+ Claude要約を実装
- 添付解析結果を会話生成・見積りプロンプトへ注入
- 管理画面に添付資料タブを追加
- `api_usage_logs` テーブルを追加し、xAI/Claude の tokens/cost/quota を記録
- xAI Responses / Anthropic Messages に日次・月次クォータガードを導入
- クォータ超過時に API ルートを 429 応答へ統一（見積り/会話/変更見積り）
- `market_evidence.usage` へ xAI usage を保存
- 見積りへ Evidence Appendix（source_url/retrieved_at/confidence）を自動保存
- 2ソース未達時は `estimate_status=draft` とし顧客提示をガード

### 3.2 残件（Day2繰越）
- ジョブ実行の定期化（Cron/Worker常駐化）  
- PDF OCR（画像PDF対応）  
- 非公開リポジトリ（GitHub Appトークン経由）対応  

### 3.3 Day3実装結果（今回）
- PRICE-104-T1/T2 を実装
  - `estimates` に `approval_required / approval_status / approval_block_reason` を追加
  - `risk_flags` から承認トリガー生成し、`approval_requests` を自動起票
  - 承認ステータス反映時に見積ステータスを再計算して `draft/ready` を同期
- CHG-102-T1 を実装
  - `change_request_billable_rules` テーブルを新設し、保証期間/責任区分/再現性で有償判定
  - `change_requests` に判定入力（`responsibility_type`,`reproducibility`）と評価結果（`billable_rule_id`,`billable_evaluation`）を保存
  - 管理API `/api/admin/change-request-billable-rules` を追加
  - 管理UIで責任区分/再現性入力を追加

### 3.4 Day4実装結果（今回）
- CHG-106-T1 を実装
  - 承認リクエストへ `required_role` を導入（`admin/sales/dev`）
  - `approval_request` 更新APIで required role 検証を強制
  - 承認自動起票時に request_type から required role を自動割当
- GOV-101-T1 を実装（部分完了）
  - 認可基盤を `admin/sales/dev/customer` へ拡張（allowlist + `team_members`）
  - `/admin` レイアウトを internal role のみに制限
  - `/admin/approvals` 承認キュー画面を追加
  - 見積生成APIを role-based 制御へ変更（新規見積: admin/sales、変更見積: admin/sales/dev）
  - `team_members` 管理APIを追加（`/api/admin/team-members`）

### 3.5 Day5実装結果（今回）
- GOV-102-T1 を実装
  - 主要監査ログアクションの必須リストを追加（`src/lib/audit/required-actions.ts`）
  - 必須監査アクションの網羅性テストを追加（`src/lib/audit/__tests__/required-actions.test.ts`）
- OPS-ANL-01 を最小運用で実装
  - cron専用実行APIを追加（`/api/source-analysis/jobs/cron`）
  - cronシークレット検証ロジックとユニットテストを追加
  - GitHub Actions の schedule で30分間隔実行できる workflow を追加
- CI品質ゲートを強化
  - CIを `lint/type-check/unit-tests/migration-check/build/e2e-smoke/quality-gate` に分割
  - unit-test coverage artifact と playwright report artifact を保存
  - dependency-review をPRで実行

## 4. 既存チケットへの紐付け更新

今回実装は主に以下へ寄与:
- DATA-110: `Partial` の品質向上（添付根拠の自動解析保存）
- GOV-102: `Partial` の品質向上（解析ジョブの監査ログ追加）
- CHG-105: `Partial` の品質向上（見積り時の添付コンテキスト反映）

ただし、ステータスを `Done` に引き上げるには顧客提示フォーマット/PDF出力/承認連携が必要。

## 5. 次スプリント（Sprint N+2）実行タスク

期間: 1週間（5営業日）  
ゴール: 「客観数値の確定ガード」と「承認統制」をP0水準で完了する。

### 5.1 Story単位（優先度順）

| Story | Priority | 今スプリントの完了条件 |
|---|---:|---|
| DATA-109 | P0 | API使用量・コスト台帳、日次上限、超過予兆アラートが有効 |
| DATA-110 | P0 | 見積りごとに evidence appendix（URL/取得時刻/信頼度）を自動出力 |
| PRICE-104 | P0 | 下限割れ時に `approval_requests` が自動起票され、承認なし確定不可 |
| CHG-102 | P0 | 無償/有償判定ルール（保証期間/責任区分/再現条件）をルール化 |
| CHG-106 | P0 | 変更見積り承認ゲート（role別）を有効化 |
| GOV-101 | P0 | RBACを admin/sales/dev/customer まで拡張 |
| GOV-102 | P0 | 主要mutationの監査ログ網羅率100% |

### 5.2 Jira起票用 Task 分解（新規）

| ID | Type | Priority | Summary | AC | Depends |
|---|---|---:|---|---|---|
| DATA-109-T1 | Task | P0 | API usage ledger 実装 | xAI/Claude 呼び出しの tokens/cost/quota を `api_usage_logs` へ保存（完了） | DATA-101 |
| DATA-109-T2 | Task | P0 | クォータ制限ガード | xAI/Claude の日次/月次上限超過で呼び出し停止・429応答・fallback（完了） | DATA-109-T1 |
| DATA-109-T3 | Task | P1 | クォータ予兆通知 | 80%/95% 到達で Slack/メール通知 | DATA-109-T1 |
| DATA-110-T1 | Task | P0 | Evidence Appendix 生成 | 見積りごとに source_url/retrieved_at/confidence を添付（完了） | DATA-108 |
| DATA-110-T2 | Task | P0 | 2ソース確定ガード | 要件未達時に見積りを `draft` のままブロック（完了） | DATA-110-T1 |
| PRICE-104-T1 | Task | P0 | 下限割れ時承認リクエスト自動作成 | floor breach で `approval_requests` を起票 | PRICE-103 |
| PRICE-104-T2 | Task | P0 | 承認完了まで確定禁止 | 承認ステータスが `approved` 以外は送付不可 | PRICE-104-T1 |
| CHG-102-T1 | Task | P0 | 無償/有償判定ルールエンジン | ルール表を設定可能にし、判定根拠を保存 | CHG-101 |
| CHG-106-T1 | Task | P0 | 変更見積り承認フロー | 高額/高リスク時に role別承認必須化 | GOV-101 |
| GOV-101-T1 | Task | P0 | RBAC拡張 | sales/dev/customer の権限境界をAPIテスト付きで実装 | GOV-101 |
| GOV-102-T1 | Task | P0 | 監査ログ網羅テスト | 見積/承認/手動補正/解析ジョブの全操作を記録検証 | GOV-102 |
| OPS-ANL-01 | Task | P1 | 解析ジョブの定期実行 | Cron or Workerで `source_analysis_jobs` を自動消化 | - |
| OPS-ANL-02 | Task | P1 | PDF OCR対応 | 画像PDFの本文抽出を追加 | OPS-ANL-01 |
| OPS-ANL-03 | Task | P1 | 非公開GitHub解析 | GitHub Appトークンで private repo を解析 | DATA-101 |

### 5.3 日次計画（Sprint N+2）

- Day1: DATA-109-T1/T2（usage ledger + hard quota）✅
- Day2: DATA-110-T1/T2（evidence appendix + 2ソースガード）✅
- Day3: PRICE-104-T1/T2 + CHG-102-T1 ✅
- Day4: CHG-106-T1 + GOV-101-T1 ✅（GOV-101は残りAPI境界テストをDay5へ）
- Day5: GOV-102-T1 + OPS-ANL-01 の最小運用化 ✅

## 6. 既知リスク

- 解析ジョブは現状APIトリガー実行中心で、定期バッチ未導入  
- 画像PDFのOCRは未実装で、本文抽出の精度に制限あり  

## 7. 最新ドキュメント整合チェック（2026-02-12）

- xAI Responses API:
  - `POST /v1/responses` を継続採用
  - `tools` は `web_search` / `x_search` 形式を採用
  - `citations` / `inline_citations` を抽出対象に拡張
- xAI Rate Limits:
  - `usage` 情報を `api_usage_logs` に保存（token + quotaスナップショット）
  - `cost_in_usd_ticks` は生値を `metadata.reported_cost_usd_ticks` として保持
- Anthropic Messages API / SDK:
  - `messages.create` の `usage.input_tokens` / `usage.output_tokens` を記録
  - クォータ超過時の呼び出し停止と 429 応答をルート側に反映

## 8. Sprint N+3 Day1 実装着手（2026-02-13）

- CI quality gate を強化
  - `quality-gate` で全job resultを明示評価
  - `ENABLE_DEPENDENCY_REVIEW=true` かつ `DEPENDENCY_REVIEW_SUPPORTED=true` 時に dependency-review 成功を必須化
  - workflow default permissions を `contents:read` へ最小化
- Admin サーバーコンポーネントの Supabase クライアントを service-role に統一
  - 対象: `admin/page`, `admin/approvals/page`, `admin/projects/page`, `admin/estimates/page`, `admin/projects/[id]/page`
- Supabase Day1 hardening migration を追加
  - FK index 4件（`approval_requests(change_request_id|estimate_id)`, `change_requests(billable_rule_id)`, `estimate_versions(project_id)`）
  - RLS enable 11テーブル（pricing/data/approval/audit/change系）

## 9. Sprint N+3 Day2 実装着手（2026-02-13）

- `admins` 設定更新を Clerk + service-role API に移行
  - `GET/PUT /api/admin/profile` を追加
  - `clerk_user_id` をキーに設定を取得/更新
- 管理設定UIを API ベースへ更新
  - `src/app/admin/settings/page.tsx` で Supabase Auth 依存を廃止
- 監査網羅性を拡張
  - `admin_profile.upsert` を監査必須アクションへ追加

## 10. Sprint N+3 Day3 実装着手（2026-02-13）

- REL-SEC-001: Supabase本番へ `day1_security_hardening` migration を適用
  - `rls_disabled_in_public` は解消、次は `rls_enabled_no_policy` の段階的整備へ移行
- REL-DATA-001/002: 市場根拠フォールバック実装を開始
  - xAI取得失敗/クォータ時に `market_evidence` の前回確定値へフォールバック
  - freshness TTL を参照し、鮮度警告を evidence appendix の `warnings` に保持
  - `risk_flags` に `market_evidence_fallback_used` を追加
- REL-QA-001: フォールバックのユニットテスト追加
