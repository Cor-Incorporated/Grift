# The Benevolent Dictator - 実装計画書 v2.0

## 概要

複数顧客の依頼（新規開発・バグ報告・修正依頼・機能追加）を AI 執事が一問一答で完璧な仕様書に磨き上げ、案件タイプに応じて「反論不能の見積り」または「工数見積り」を自動生成する高効率案件管理システム。

---

## 案件タイプと対応フロー

本システムは 4 つの案件タイプを扱い、タイプごとに対話・見積りロジックが分岐する。

| タイプ | 説明 | 対話の焦点 | 見積り方式 |
| --- | --- | --- | --- |
| `new_project` | 新規開発 | 要件の網羅的ヒアリング | 市場比較見積り（時給 x 工数 + 市場対比レポート） |
| `bug_report` | 既存システムのバグ報告 | 再現手順・環境・影響範囲の特定 | 工数見積りのみ（調査 + 修正 + テスト時間） |
| `fix_request` | 既存機能の修正依頼 | 現状 vs 期待動作の差分明確化 | 工数見積りのみ（影響範囲 + 修正 + 回帰テスト時間） |
| `feature_addition` | 既存システムへの機能追加 | 既存アーキテクチャとの整合性確認 | ハイブリッド（工数ベース + オプションで市場比較） |

### タイプ別 対話フロー

```
顧客アクセス → 案件タイプ選択
  │
  ├─ new_project ──→ フル詰問（要件定義フロー）
  │                  → 市場比較見積り生成
  │
  ├─ bug_report ───→ バグ特化ヒアリング
  │                  - 発生環境（OS/ブラウザ/バージョン）
  │                  - 再現手順（ステップバイステップ）
  │                  - 期待動作 vs 実際の動作
  │                  - エラーログ/スクリーンショット
  │                  - 影響範囲（他機能への波及）
  │                  → 工数見積り生成
  │
  ├─ fix_request ──→ 修正特化ヒアリング
  │                  - 対象機能の特定
  │                  - 現在の動作の説明
  │                  - 期待する修正後の動作
  │                  - 修正の優先度/緊急度
  │                  - 関連する既存仕様書/チケット
  │                  → 工数見積り生成
  │
  └─ feature_addition → 追加機能ヒアリング
                     - 既存システムの構成確認
                     - 追加したい機能の詳細
                     - 既存機能との依存関係
                     - 非機能要件（パフォーマンス等）
                     → ハイブリッド見積り生成
```

### タイプ別 見積りモデル

**A. 市場比較見積り**（`new_project` / `feature_addition` オプション）

```
Estimate = YourActualHours × (MarketHourlyRate × Multiplier)
出力: 市場対比レポート（市場総コスト vs 自社総コスト）
```

**B. 工数見積り**（`bug_report` / `fix_request` / `feature_addition` デフォルト）

```
Estimate = (調査時間 + 実装時間 + テスト時間 + バッファ) × HourlyRate
出力: 工数内訳書（フェーズ別の時間と根拠）
```

| 工数フェーズ | bug_report | fix_request | feature_addition |
| --- | --- | --- | --- |
| 調査・分析 | 重い（原因特定） | 中（差分分析） | 中（既存コード理解） |
| 実装 | 軽〜重（原因次第） | 中 | 重い（新規コード） |
| テスト | 中（回帰テスト） | 中（回帰テスト） | 重い（新規+回帰） |
| バッファ | 20-30%（不確実性高） | 10-20% | 15-25% |

---

## 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| Frontend | Next.js 15 (App Router) + shadcn/ui + Tailwind CSS | 要件指定 |
| Backend | Supabase (PostgreSQL + pgvector + Edge Functions + Auth + Storage) | 要件指定 |
| AI (対話・解析) | Claude 4.6 Opus (Anthropic API) | 要件指定 |
| AI (市場調査) | xAI Grok API | 要件指定 |
| Integration | GitHub App (Multi-Org) | 要件指定 |
| Hosting | Vercel (Frontend) + Supabase (Backend) | Next.js との親和性 |
| Testing | Vitest + Playwright + Testing Library | 品質保証 |

---

## エージェントチーム構成

### Sprint 実行時のチーム

| エージェント | 役割 | 担当領域 |
|-------------|------|---------|
| **architect** | システム設計 | DB スキーマ、API 設計、全体アーキテクチャ |
| **backend-developer** | バックエンド実装 | Supabase Edge Functions、DB、API |
| **typescript-pro** | フロントエンド実装 | Next.js、React コンポーネント、型安全 |
| **api-designer** | API 設計 | REST/GraphQL エンドポイント設計 |
| **security-reviewer** | セキュリティ | 認証・認可、入力検証、OWASP 対応 |
| **tdd-guide** | テスト | TDD ワークフロー強制、カバレッジ管理 |
| **code-reviewer** | 品質管理 | コードレビュー、パターン遵守 |
| **e2e-runner** | E2E テスト | Playwright による E2E テスト |

### レビュー・議論フロー

```
architect → 設計レビュー → backend-developer + typescript-pro（並列実装）
  → code-reviewer（コードレビュー）
  → security-reviewer（セキュリティレビュー）
  → tdd-guide（テスト確認）
  → e2e-runner（E2E テスト）
```

---

## 必須環境変数

```bash
# ============================================
# .env.local に設定する環境変数一覧
# ============================================

# --- Supabase ---
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...

# --- Anthropic (Claude 4.6 Opus) ---
ANTHROPIC_API_KEY=sk-ant-api03-...

# --- xAI (Grok API) ---
XAI_API_KEY=xai-...

# --- GitHub App ---
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxx
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxxxx
GITHUB_APP_WEBHOOK_SECRET=whsec_xxxxxxxxxx

# --- App ---
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 環境変数の取得方法

| 変数 | 取得元 |
|------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Supabase ダッシュボード > Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase ダッシュボード > Settings > API (service_role) |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `XAI_API_KEY` | https://console.x.ai/ |
| `GITHUB_APP_*` | https://github.com/settings/apps > New GitHub App |

---

## データベーススキーマ（概要）

```sql
-- 顧客
customers (
  id uuid PK,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  company text,
  created_at timestamptz
)

-- プロジェクト（案件）
projects (
  id uuid PK,
  customer_id uuid FK -> customers,
  title text NOT NULL,
  type text NOT NULL CHECK (new_project|bug_report|fix_request|feature_addition),
  status text CHECK (draft|interviewing|analyzing|estimating|completed|rejected|on_hold),
  priority text CHECK (low|medium|high|critical),  -- バグ/修正の緊急度
  existing_system_url text,   -- 既存システムの URL/リポジトリ（バグ・修正・追加時）
  spec_markdown text,         -- 生成された要件定義書 or バグレポート
  created_at timestamptz,
  updated_at timestamptz
)

-- 対話履歴
conversations (
  id uuid PK,
  project_id uuid FK -> projects,
  role text CHECK (assistant|user|system),
  content text NOT NULL,
  metadata jsonb,            -- 質問カテゴリ、確信度など
  created_at timestamptz
)

-- アップロードファイル
project_files (
  id uuid PK,
  project_id uuid FK -> projects,
  file_path text NOT NULL,   -- Supabase Storage パス
  file_type text,            -- image, pdf, zip
  analysis_result jsonb,     -- AI 解析結果
  created_at timestamptz
)

-- GitHub 実績（ベクトル検索用）
github_references (
  id uuid PK,
  org_name text NOT NULL,
  repo_name text NOT NULL,
  pr_title text,
  description text,
  language text,
  hours_spent numeric,       -- 実績工数
  embedding vector(1536),    -- pgvector
  metadata jsonb,
  created_at timestamptz
)

-- 見積り（タイプ別対応）
estimates (
  id uuid PK,
  project_id uuid FK -> projects,
  estimate_mode text NOT NULL CHECK (market_comparison|hours_only|hybrid),
  -- 共通フィールド
  your_hourly_rate numeric NOT NULL,
  your_estimated_hours numeric NOT NULL,
  total_your_cost numeric GENERATED,
  -- 工数内訳（bug_report / fix_request / feature_addition）
  hours_investigation numeric,   -- 調査・分析時間
  hours_implementation numeric,  -- 実装時間
  hours_testing numeric,         -- テスト時間
  hours_buffer numeric,          -- バッファ時間
  hours_breakdown_report text,   -- 工数内訳書 Markdown
  -- 市場比較（new_project / feature_addition オプション）
  market_hourly_rate numeric,
  market_estimated_hours numeric,
  multiplier numeric DEFAULT 1.5,
  total_market_cost numeric,
  comparison_report text,        -- 市場対比レポート Markdown
  grok_market_data jsonb,        -- Grok 生データ
  -- GitHub 実績参照
  similar_projects jsonb,        -- 類似案件の実績データ
  created_at timestamptz
)

-- 管理者
admins (
  id uuid PK,
  user_id uuid FK -> auth.users,
  github_orgs text[],       -- 連携 Org 一覧
  default_hourly_rate numeric,
  created_at timestamptz
)
```

---

## Sprint 計画

### Sprint 0: 基盤構築（1-2日）
> **目標**: プロジェクトの骨格を作り、開発環境を完全に整える

#### タスク

- [ ] `cc:TODO` Next.js 15 プロジェクトスキャフォールディング（App Router）
- [ ] `cc:TODO` shadcn/ui + Tailwind CSS セットアップ
- [ ] `cc:TODO` Supabase プロジェクト接続・初期設定
- [ ] `cc:TODO` DB マイグレーション基盤（上記スキーマ）
- [ ] `cc:TODO` pgvector 拡張有効化
- [ ] `cc:TODO` Supabase Auth 設定（管理者ログイン）
- [ ] `cc:TODO` RLS ポリシー基本設定
- [ ] `cc:TODO` 環境変数テンプレート（`.env.example`）作成
- [ ] `cc:TODO` ESLint + Prettier + Husky 設定
- [ ] `cc:TODO` Vitest + Playwright 設定
- [ ] `cc:TODO` Git リポジトリ初期化 + 初回コミット

#### エージェント割り当て
- **architect**: スキーマ設計レビュー
- **typescript-pro**: Next.js スキャフォールディング
- **backend-developer**: Supabase セットアップ + マイグレーション
- **security-reviewer**: RLS ポリシー + Auth 設定レビュー

#### 完了基準
- `npm run dev` でローカル起動、Supabase 接続確認
- 全テーブル作成済み、RLS 有効
- テストランナー動作確認

---

### Sprint 1: AI 執事 対話エンジン（4-5日）
> **目標**: Claude 4.6 による案件タイプ別アキネーター形式の一問一答 UI を完成させる

#### タスク

- [ ] `cc:TODO` Anthropic SDK セットアップ（Edge Function）
- [ ] `cc:TODO` 案件タイプ選択 UI（初回アクセス時）
  - new_project / bug_report / fix_request / feature_addition の 4 択
  - 各タイプの説明・アイコン付きカード
- [ ] `cc:TODO` 対話エンジンコア実装（タイプ別分岐）
  - タイプ別システムプロンプト設計（執事ペルソナ + 詰問ロジック）
  - **new_project**: 要件網羅型の質問ツリー
  - **bug_report**: 再現手順・環境・影響範囲の特定フロー
  - **fix_request**: 現状 vs 期待動作の差分明確化フロー
  - **feature_addition**: 既存システム理解 + 新機能要件ヒアリングフロー
  - 質問生成アルゴリズム（曖昧さスコアに基づく次質問決定）
  - 会話状態管理（確認済み項目の追跡）
- [ ] `cc:TODO` 対話 API エンドポイント（`/api/conversations`）
- [ ] `cc:TODO` チャット UI コンポーネント
  - メッセージバブル（assistant / user）
  - テキスト入力 + 選択肢ボタン（アキネーター風）
  - タイピングインジケーター
  - 進捗バー（要件定義/バグ特定の完成度）
  - 優先度選択（bug_report / fix_request 時）
  - 既存システム URL 入力（bug/fix/addition 時）
- [ ] `cc:TODO` 会話履歴の保存・復元
- [ ] `cc:TODO` 「曖昧さ排除」判定ロジック
  - タイプ別の必須カテゴリ定義
  - 全必須カテゴリの確認度が閾値を超えたら管理者通知
- [ ] `cc:TODO` アウトプット Markdown 自動生成（タイプ別テンプレート）
  - new_project → 要件定義書
  - bug_report → バグレポート（再現手順・影響範囲付き）
  - fix_request → 修正仕様書（Before/After 明記）
  - feature_addition → 機能追加仕様書（既存との差分明記）
- [ ] `cc:TODO` ユニットテスト + 統合テスト

#### エージェント割り当て
- **architect**: 対話エンジン設計・タイプ別プロンプト設計
- **typescript-pro**: チャット UI + タイプ選択 UI 実装
- **backend-developer**: Edge Function + API 実装
- **api-designer**: 対話 API 設計
- **tdd-guide**: テスト駆動開発

#### 完了基準
- 顧客が URL を開き、案件タイプを選択して対話を開始できる
- 4 タイプすべてで対話 → Markdown ドキュメント生成が動作する
- バグ報告時に再現手順が構造化されて出力される
- 曖昧さスコアに基づく質問制御がタイプ別に動作する

---

### Sprint 2: ファイル解析エンジン（2-3日）
> **目標**: 顧客がアップロードした資料を AI が解析し、対話に反映する

#### タスク

- [ ] `cc:TODO` Supabase Storage バケット設定（project-files）
- [ ] `cc:TODO` ファイルアップロード UI（ドラッグ＆ドロップ）
- [ ] `cc:TODO` ファイルタイプ別解析パイプライン
  - 画像: Claude Vision API で解析
  - PDF: テキスト抽出 + Claude 要約
  - ZIP: 展開 → ファイル構造解析 → 主要ファイル解析
- [ ] `cc:TODO` 解析結果の対話エンジンへの注入
- [ ] `cc:TODO` ファイルプレビュー UI
- [ ] `cc:TODO` サンドボックス実行環境（ZIP 内コード解析用）
- [ ] `cc:TODO` セキュリティ対策（ファイルサイズ制限、型検証、ウイルススキャン方針）
- [ ] `cc:TODO` テスト

#### エージェント割り当て
- **backend-developer**: Storage + 解析パイプライン
- **typescript-pro**: アップロード UI
- **security-reviewer**: ファイル処理セキュリティ
- **tdd-guide**: テスト

#### 完了基準
- 画像、PDF、ZIP のアップロード・解析が動作
- 解析結果が対話に反映される
- ファイルサイズ制限・型検証が機能

---

### Sprint 3: GitHub 連携（3-4日）
> **目標**: GitHub App で過去実績を取得し、ベクトル検索で類似案件を自動参照する

#### タスク

- [ ] `cc:TODO` GitHub App 作成・設定ガイド
- [ ] `cc:TODO` GitHub App OAuth フロー実装
- [ ] `cc:TODO` Multi-Org インストール対応
- [ ] `cc:TODO` Webhook 受信エンドポイント（PR マージイベント）
- [ ] `cc:TODO` リポジトリ/PR データ取得バッチ
  - PR タイトル、本文、差分サマリ、レビューコメント
  - 言語・フレームワーク検出
  - 工数推定（PR サイズ + レビュー期間）
- [ ] `cc:TODO` pgvector エンベディング生成・保存
  - Anthropic Embeddings API or OpenAI Embeddings
- [ ] `cc:TODO` 類似案件検索 API
  - コサイン類似度でトップ N 件取得
- [ ] `cc:TODO` 管理者 GitHub 設定 UI
- [ ] `cc:TODO` テスト

#### エージェント割り当て
- **backend-developer**: GitHub App + Webhook + バッチ処理
- **api-designer**: GitHub 連携 API 設計
- **typescript-pro**: 管理者設定 UI
- **security-reviewer**: OAuth フロー + Webhook 検証
- **tdd-guide**: テスト

#### 完了基準
- GitHub App インストール → Org のリポジトリ一覧取得
- PR データが pgvector に保存され、類似検索が動作
- Webhook でリアルタイム更新

---

### Sprint 4: 市場調査エンジン - Grok 連携（2-3日）
> **目標**: Grok API で SNS 上の最新市場情報（単価・技術トレンド）を取得する

#### タスク

- [ ] `cc:TODO` xAI Grok API クライアント実装
- [ ] `cc:TODO` 市場調査クエリ生成ロジック
  - 技術スタック × 地域 × 経験年数 での単価調査
  - 「地雷技術」検出（炎上率が高い技術の識別）
  - 最新トレンド取得
- [ ] `cc:TODO` 市場データ構造化・保存
- [ ] `cc:TODO` キャッシュ戦略（同一クエリの再利用）
- [ ] `cc:TODO` レート制限ハンドリング
- [ ] `cc:TODO` テスト（Grok API モック含む）

#### エージェント割り当て
- **backend-developer**: Grok API 統合
- **api-designer**: 市場調査 API 設計
- **tdd-guide**: テスト（モック戦略）

#### 完了基準
- 技術スタックを入力 → 市場単価・トレンドが返る
- キャッシュが効いて冗長な API 呼び出しを防止
- エラーハンドリング・レート制限対応済み

---

### Sprint 5: 見積りエンジン（4-5日）
> **目標**: 案件タイプに応じた見積りを自動生成する（市場比較 / 工数のみ / ハイブリッド）

#### タスク

- [ ] `cc:TODO` 見積りモード分岐ロジック
  - `new_project` → market_comparison モード
  - `bug_report` / `fix_request` → hours_only モード
  - `feature_addition` → hybrid モード（デフォルト工数、オプション市場比較）
- [ ] `cc:TODO` **市場比較見積り**アルゴリズム（new_project 用）
  ```
  Estimate = YourActualHours × (MarketHourlyRate × Multiplier)
  ```
  - 要件定義書 → タスク分解 → 工数推定
  - GitHub 実績 → 類似案件の実績工数参照
  - Grok 市場データ → 市場単価・市場推定工数
  - 対比レポート生成（市場総コスト vs 自社総コスト）
- [ ] `cc:TODO` **工数見積り**アルゴリズム（bug/fix 用）
  - バグレポート/修正仕様書 → フェーズ別工数算出
    - 調査・分析時間（バグ原因特定 / 修正箇所特定）
    - 実装時間（修正コード量 + 複雑度）
    - テスト時間（回帰テスト範囲）
    - バッファ（不確実性に基づく係数: bug 20-30%, fix 10-20%）
  - GitHub 実績 → 類似バグ修正の実績工数参照
  - 工数内訳書 Markdown 生成
- [ ] `cc:TODO` **ハイブリッド見積り**（feature_addition 用）
  - 工数ベースをデフォルト表示
  - 管理者が「市場比較も出す」をトグルで選択可能
- [ ] `cc:TODO` 見積り UI（タイプ別表示）
  - 管理者向け: 全モードの調整ダッシュボード
  - 顧客向け bug/fix: 工数内訳と合計金額のシンプル表示
  - 顧客向け new_project: 市場対比レポート付きリッチ表示
- [ ] `cc:TODO` PDF エクスポート（タイプ別テンプレート）
- [ ] `cc:TODO` 管理者への通知（対話完了 → 見積り準備完了）
- [ ] `cc:TODO` テスト

#### エージェント割り当て
- **architect**: 見積りアルゴリズム設計（3 モード）
- **backend-developer**: データ統合 + 見積り計算
- **typescript-pro**: 見積り UI（タイプ別表示）
- **tdd-guide**: テスト
- **code-reviewer**: アルゴリズムレビュー

#### 完了基準
- 4 タイプすべてで対話完了 → 適切なモードの見積り自動生成
- bug/fix: 工数内訳書が Markdown/PDF 出力される
- new_project: 市場対比レポートが Markdown/PDF 出力される
- feature_addition: 工数ベース + オプション市場比較が動作
- 管理者が全モードで見積りパラメータを調整可能

---

### Sprint 6: 管理者ダッシュボード（2-3日）
> **目標**: 管理者が全案件を俯瞰・管理できるダッシュボードを完成させる

#### タスク

- [ ] `cc:TODO` ダッシュボードレイアウト
  - 案件一覧（ステータス別フィルター）
  - 案件詳細ビュー
  - 対話ログ閲覧
- [ ] `cc:TODO` 管理者アクション
  - 見積りの手動調整・承認
  - 顧客への見積り送付
  - 要件定義書の手動編集
- [ ] `cc:TODO` 通知システム
  - 対話完了通知
  - 見積り準備完了通知
  - メール/Slack 連携（オプション）
- [ ] `cc:TODO` リアルタイム更新（Supabase Realtime）
- [ ] `cc:TODO` テスト

#### エージェント割り当て
- **typescript-pro**: ダッシュボード UI
- **backend-developer**: Realtime + 通知
- **e2e-runner**: E2E テスト
- **tdd-guide**: テスト

#### 完了基準
- 管理者が全案件のステータスを一覧で確認
- 見積りの調整・承認・送付フロー完成
- リアルタイム更新が動作

---

### Sprint 7: セキュリティ強化 & プロダクション準備（2-3日）
> **目標**: プロダクションレベルの品質・セキュリティを達成する

#### タスク

- [ ] `cc:TODO` 全 RLS ポリシーの最終レビュー・強化
- [ ] `cc:TODO` 入力バリデーション全箇所確認（Zod スキーマ）
- [ ] `cc:TODO` レート制限実装（API エンドポイント全般）
- [ ] `cc:TODO` エラーハンドリング統一
- [ ] `cc:TODO` ログ・監査証跡（Supabase Edge Functions）
- [ ] `cc:TODO` パフォーマンス最適化
  - DB インデックス最適化
  - API レスポンスキャッシュ
  - Next.js ISR/SSG 活用
- [ ] `cc:TODO` Vercel デプロイ設定
- [ ] `cc:TODO` Supabase 本番環境設定
- [ ] `cc:TODO` E2E テスト全フロー
- [ ] `cc:TODO` 負荷テスト基本実施
- [ ] `cc:TODO` セキュリティ監査（OWASP Top 10）

#### エージェント割り当て
- **security-reviewer**: 全体セキュリティ監査
- **code-reviewer**: コード品質最終レビュー
- **e2e-runner**: E2E テスト全フロー
- **backend-developer**: パフォーマンス最適化
- **typescript-pro**: フロントエンド最適化

#### 完了基準
- OWASP Top 10 チェック完了
- E2E テスト全パス
- 本番環境デプロイ成功
- Lighthouse スコア 90+

---

## 全体タイムライン

```
Sprint 0: 基盤構築             ██░░░░░░░░░░░░░░░░░░░░  (1-2日)
Sprint 1: AI 対話エンジン      ░░████████░░░░░░░░░░░░  (4-5日) ★タイプ別分岐
Sprint 2: ファイル解析         ░░░░░░░░████░░░░░░░░░░  (2-3日)
Sprint 3: GitHub 連携          ░░░░░░░░░░██████░░░░░░  (3-4日)
Sprint 4: Grok 市場調査        ░░░░░░░░░░██████░░░░░░  (2-3日) ←S3と並列可
Sprint 5: 見積りエンジン       ░░░░░░░░░░░░░░████████  (4-5日) ★3モード対応
Sprint 6: 管理者ダッシュボード ░░░░░░░░░░░░░░░░░░████  (2-3日)
Sprint 7: プロダクション準備   ░░░░░░░░░░░░░░░░░░░░██  (2-3日)
                               ──────────────────────
                               合計: 約 20-28日 (4-5週間)
```

> **Note**: Sprint 3 と Sprint 4 は並列実行可能（依存関係なし）。並列時は合計 18-25日 に短縮可。

---

## 各 Sprint 実行プロトコル

1. **計画フェーズ**: architect エージェントが設計レビュー
2. **実装フェーズ**: backend-developer + typescript-pro が並列実装
3. **テストフェーズ**: tdd-guide が TDD 強制、e2e-runner が E2E テスト
4. **レビューフェーズ**: code-reviewer + security-reviewer が品質チェック
5. **実動テスト**: ユーザーによる手動テスト・フィードバック
6. **修正フェーズ**: フィードバック反映

---

## リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| Grok API の仕様変更・制限 | 市場調査機能停止 | フォールバック（Web スクレイピング） |
| GitHub API レート制限 | データ取得遅延 | キャッシュ + バッチ処理 |
| Claude API コスト | 運用費増大 | プロンプト最適化 + キャッシュ |
| pgvector 精度 | 類似検索品質低下 | エンベディングモデル選定テスト |
| ファイル解析セキュリティ | 悪意あるファイル | サンドボックス + サイズ制限 |

---

## 次のステップ

1. **ユーザー**: 上記環境変数を全て取得・設定
2. **Claude Code**: Sprint 0 からエージェントチームで実装開始
3. **各 Sprint 完了時**: 実動テスト → フィードバック → 修正のサイクル
