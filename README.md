# BenevolentDirector

AI 執事が顧客の曖昧な依頼を完璧な仕様書と見積りに変換し、Linear.app で開発タスクを管理する案件管理システム。

## v2 再構築の準備

v2 は `React + Go + Python + GCP` を前提に別アーキテクチャで再構築します。現時点のガードレールと契約は以下に集約しています。

- `docs/v2`: v2 のアーキテクチャ、ADR、運用前提、PoC 合格基準、テスト戦略
- `packages/contracts`: `openapi.yaml` と `initial-schema.sql` による contract-first の SSOT
- `apps/web`: v2 の React Web クライアント骨格
- `services/control-api`: v2 の Go control plane 骨格
- `services/intelligence-worker`: v2 の Python intelligence plane 骨格
- `services/llm-gateway`: v2 のローカル LLM / クラウド LLM ルーティング層骨格
- `infra/terraform`: GCP 前提の Terraform 骨格

現行の Next.js 実装は v1 参照実装として扱います。`.env.local` はアーカイブ対象にせず、当面は repo root に残します。

## できること

| 機能 | 説明 |
|------|------|
| AI 一問一答ヒアリング | 案件タイプ別（新規/バグ/修正/機能追加）にアキネーター形式で要件を詰める |
| 自動仕様書生成 | ヒアリング完了時に Markdown 仕様書を自動出力 |
| 自動見積り生成 | 仕様書から工数・市場比較・価格を自動算出（バグ/修正は工数のみ） |
| GitHub リポジトリ解析 | コードベース分析 + Velocity メトリクスで見積り精度を向上 |
| 市場エビデンス取得 | Grok API で類似案件の市場単価を自動調査 |
| Go/No-Go 判定 | 収益性・技術リスク・キャパシティを総合評価して受注判定 |
| Linear 連携 | 承認済み見積りから Linear の Project/Cycle/Issue を自動作成 |
| 管理者ダッシュボード | 全案件の状態管理、対話ログ閲覧、見積り調整 |
| 添付ファイル解析 | ZIP/PDF/画像/URL を AI が解析し、対話・見積りに反映 |

## 案件タイプ別の見積り方式

| タイプ | 見積り | 金額表示 |
|--------|--------|----------|
| `new_project` | 市場比較（工数 + 市場対比 + 価格エンジン） | あり |
| `feature_addition` | ハイブリッド（工数 + 市場比較） | あり |
| `bug_report` | 工数のみ（調査/修正/テスト/バッファ） | なし（保証範囲） |
| `fix_request` | 工数のみ | なし（契約範囲） |

## セットアップ

### 前提条件

- Node.js 20+
- npm 10+
- Go 1.24+
- Python 3.12+
- Docker / Docker Compose
- mise

### インストール

```bash
git clone https://github.com/Cor-Incorporated/BenevolentDirector.git
cd BenevolentDirector
cp .env.example .env.local
# .env.local に各種 API キーを設定（下表参照）
```

v2 のローカル基盤起動:

```bash
mise run dev
```

v1 参照実装を触る場合:

```bash
cd v1
npm ci
npm run dev
```

### 環境変数

`.env.example` を `.env.local` にコピーして設定：

| 変数グループ | 必須 | 取得元 |
|-------------|------|--------|
| Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`) | 必須 | [Supabase Dashboard](https://supabase.com/dashboard) > Settings > API |
| Clerk (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) | 必須 | [Clerk Dashboard](https://dashboard.clerk.com)（ダミー不可） |
| Anthropic (`ANTHROPIC_API_KEY`) | 必須 | [Anthropic Console](https://console.anthropic.com/settings/keys) |
| xAI Grok (`XAI_API_KEY`) | 推奨 | [xAI Console](https://console.x.ai/) |
| GitHub App (`GITHUB_APP_*`, `GITHUB_TOKEN`) | 任意 | [GitHub Settings](https://github.com/settings/apps) |
| Linear (`LINEAR_API_KEY`, `LINEAR_DEFAULT_TEAM_ID`) | 任意 | [Linear Settings](https://linear.app/settings/api) |
| RBAC (`ADMIN_EMAIL_ALLOWLIST`) | 必須 | 管理者メールアドレス（カンマ区切り） |

### DB マイグレーション

```bash
# v1 参照実装
cd v1 && supabase db push

# v2 contract-first SSOT
packages/contracts/initial-schema.sql
```

### 起動

```bash
mise run dev
```

## コマンド一覧

```bash
mise run dev             # v2 インフラ起動 + サービス起動コマンド表示
mise run lint            # v2 Go / Python / React lint
mise run test            # v2 テスト
mise run build           # v2 ビルド
npm run ci:v2:openapi    # v2 OpenAPI ガードレール検証
npm run ci:v2:schema     # v2 DDL / RLS ガードレール検証
npm run ci:v2:env        # v2 実装に必要な env キー検証
npm run ci:v2:monorepo   # v2 骨格 / docs 配置検証
npm run ci:v2:adr        # ADR ↔ schema/OpenAPI 整合性検証

cd v1 && npm run dev           # v1 Next.js 参照実装
cd v1 && npm run build
cd v1 && npm run lint
cd v1 && npm run type-check
cd v1 && npm run test
cd v1 && npm run test:e2e
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| v2 Frontend | React 19 + Vite |
| v2 Control Plane | Go |
| v2 Intelligence Plane | Python |
| v2 Data / Infra | Cloud SQL, GCS, Pub/Sub, BigQuery, GCP Terraform |
| v2 Contracts | OpenAPI 3.1 + SQL SSOT |
| v1 Reference | Next.js 16 + Clerk + Supabase + Claude + Grok |

## プロジェクト構成

```
apps/
└── web/                    # v2 React Web
services/
├── control-api/            # v2 Go API
├── intelligence-worker/    # v2 Python worker
└── llm-gateway/            # v2 Python LLM gateway
packages/
├── contracts/              # OpenAPI + DDL SSOT
├── config/                 # shared config docs
└── domain-events/          # event contracts
infra/
└── terraform/              # GCP infrastructure
docs/
└── v2/                     # ADRs, architecture, roadmap, testing
v1/                         # Next.js reference implementation
```

## v1 参照実装の主要画面

| パス | 対象 | 機能 |
|------|------|------|
| `/dashboard` | 顧客 | プロジェクト一覧・新規作成 |
| `/projects/[id]/chat` | 顧客 | AI ヒアリングチャット |
| `/projects/[id]` | 顧客 | 仕様書・見積り閲覧 |
| `/admin` | 管理者 | ダッシュボード（全案件俯瞰） |
| `/admin/projects/[id]` | 管理者 | 案件詳細 + 見積り調整 + Linear 同期 |
| `/admin/github` | 管理者 | GitHub リポジトリ管理 |

## v1 参照実装の API エンドポイント（主要）

### 顧客向け
| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/conversations/stream` | SSE チャットストリーミング |
| POST | `/api/projects` | プロジェクト作成 |
| GET | `/api/projects/[id]` | プロジェクト詳細 |
| POST | `/api/estimates` | 見積り生成 |

### 管理者向け
| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/admin/linear/sync` | Linear 手動同期 |
| GET | `/api/admin/linear/teams` | Linear チーム一覧 |
| POST | `/api/admin/github/repos` | GitHub リポジトリ同期 |
| POST | `/api/admin/github/repos/[id]` | Velocity 分析実行 |

### システム
| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/health` | ヘルスチェック（認証不要、LB/監視用） |
| POST | `/api/linear/webhooks` | Linear Webhook 受信 |

## CI/CD

### CI (`.github/workflows/ci.yml`)

`quality-gate` ジョブが以下すべての通過を要求：
- v1: `lint` → `type-check` → `unit-tests` → `migration-check` → `build` → `e2e-smoke`
- v2: `v2-openapi` → `v2-schema` → `v2-monorepo` → `v2-adr` → `v2-go-build` → `v2-python-lint` → `v2-web`

### CD (`.github/workflows/cd.yml`)

- v1 の自動デプロイ前提。v2 の本番デプロイは GCP 前提で別管理

## セキュリティ

- 全 API エンドポイントにレート制限適用（429 + Retry-After）
- CSP, HSTS, X-Frame-Options 等のセキュリティヘッダー設定済み
- Linear Webhook は HMAC-SHA256 署名検証
- Clerk RBAC による管理者/顧客アクセス制御
- Zod による全入力バリデーション

## 開発ガイドライン

- TypeScript, 2スペースインデント, シングルクォート, セミコロンなし
- kebab-case ファイル名
- `src/lib/` 内では `logger` を使用（`console.error/log` 禁止）
- 詳細は [CLAUDE.md](./CLAUDE.md) を参照

## ライセンス

Private - COR Incorporated
