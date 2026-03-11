# Grift

**AI development pricing is a grift. We're here to fix that.**

受託開発の見積りは不透明で、情報の非対称性が価格を歪めている。Grift はその構造を壊す — GitHub の実績データと市場エビデンスに基づいて、AI 開発の適正価格をリアルタイムで算出する。

## Who is Grift for?

### Primary: ソロ開発者 / 小規模 AI 開発チーム

- フリーランスエンジニア、AI 受託を企画する 1-10 人のスタートアップ
- AI 開発の価格がブレブレで、**リアルタイムの適正価格**を知りたい
- GitHub/Git の実績を客観的に数値化して**営業資料**として使いたい
- 自分の強み（開発速度・品質・専門性）を発注側に**データで証明**したい

### Secondary: 発注側企業の PM / CTO

- 依頼中の見積りが適正か、**第三者チェック**したい
- 複数ベンダーの提案を客観比較したい

### Future: 東南アジア SIer / オフショア企業

- 技術力の客観的誇示（GitHub 分析ベース）
- 先進国クライアントとの適正取引の担保

> **Why "Grift"?** — 受託見積りの不透明な価格設定こそが本当の "grift"（ぼったくり）。このツールはそれを暴く側。上流工程専門で情報の非対称性を利益源にしてきた企業がこれを嫌がるなら、名前の皮肉は成功している。

## What Grift Does

| 機能 | 説明 |
|------|------|
| AI ヒアリング | 案件タイプ別にアキネーター形式で要件を詰める（GuideAgent パターン） |
| 自動仕様書生成 | ヒアリング完了時に Markdown 仕様書を自動出力 |
| リアルタイム見積り | 工数 + 市場比較 + 価格エンジンで適正価格を算出 |
| GitHub 実績分析 | コードベース解析 + Velocity メトリクスで開発力を可視化 |
| 市場エビデンス | 類似案件の市場単価をリアルタイム調査 |
| Observation Pipeline | 会話から QA ペアを自動抽出し、見積り精度を継続改善 |
| Go/No-Go 判定 | 収益性・技術リスク・キャパシティを総合評価 |
| Linear/GitHub 連携 | 承認済み見積りからタスクを自動作成 |

### 見積りモード

| タイプ | 見積り方式 | 金額表示 |
|--------|-----------|----------|
| `new_project` | 市場比較（工数 + 市場対比 + 価格エンジン） | あり |
| `feature_addition` | ハイブリッド（工数 + 市場比較） | あり |
| `bug_report` | 工数のみ（調査/修正/テスト/バッファ） | なし（保証範囲） |
| `fix_request` | 工数のみ | なし（契約範囲） |

## Architecture

v2 は `React + Go + Python + GCP` で再構築中。ローカル LLM（Qwen3.5 on vLLM）をメインに、クラウド LLM をフォールバックとして使う。

- `docs/v2/`: アーキテクチャ、17 ADR、ロードマップ、テスト戦略
- `packages/contracts/`: `openapi.yaml` + `initial-schema.sql`（contract-first SSOT）
- `apps/web/`: React 19 + Vite
- `services/control-api/`: Go control plane
- `services/intelligence-worker/`: Python intelligence plane
- `services/llm-gateway/`: NDJSON Streaming-First LLM ルーティング（ADR-0014）
- `infra/terraform/`: GCP infrastructure

v1（Next.js）は参照実装として残す。

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
git clone https://github.com/Cor-Incorporated/Grift.git
cd Grift
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
