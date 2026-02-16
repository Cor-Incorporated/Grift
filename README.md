# BenevolentDirector

AI 執事が顧客の曖昧な依頼を完璧な仕様書と見積りに変換し、Linear.app で開発タスクを管理する案件管理システム。

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
- Supabase プロジェクト
- Clerk アカウント

### インストール

```bash
git clone https://github.com/Cor-Incorporated/BenevolentDirector.git
cd BenevolentDirector
npm ci
cp .env.example .env.local
# .env.local に各種 API キーを設定（下表参照）
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
# Supabase CLI
supabase db push

# または Supabase SQL Editor で supabase/migrations/ 内の SQL を順次実行
```

### 起動

```bash
npm run dev       # http://localhost:3000 (Turbopack)
```

## コマンド一覧

```bash
npm run dev              # 開発サーバー (Turbopack)
npm run build            # 本番ビルド (webpack)
npm run lint             # ESLint
npm run type-check       # TypeScript 型チェック
npm run test             # ユニットテスト (Vitest)
npm run test:watch       # テスト (ウォッチモード)
npm run test:coverage    # カバレッジ付きテスト
npm run test:e2e         # E2E テスト (Playwright)
npm run ci:migrations    # マイグレーションファイル順序検証
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | Next.js 16 (App Router, React 19) + shadcn/ui + Tailwind CSS v4 |
| Auth | Clerk (RBAC: admin / sales / dev / customer) |
| Database | Supabase (PostgreSQL + RLS) |
| AI (対話・解析) | Claude (Anthropic SDK) |
| AI (市場調査) | xAI Grok API |
| Task Management | Linear SDK (`@linear/sdk`) |
| Testing | Vitest + Testing Library + Playwright |
| Validation | Zod |

## プロジェクト構成

```
src/
├── app/                    # Next.js ページ & API ルート
│   ├── api/                # 全 36 エンドポイント（レート制限適用済み）
│   │   ├── health/         # ヘルスチェック（認証不要）
│   │   ├── linear/         # Linear Webhook 受信
│   │   └── admin/          # 管理者 API (github, linear, profile)
│   ├── admin/              # 管理者ダッシュボード
│   ├── dashboard/          # 顧客ダッシュボード
│   └── projects/           # プロジェクト作成・チャット
├── components/
│   ├── ui/                 # shadcn/ui プリミティブ
│   ├── chat/               # チャット UI
│   └── estimates/          # 見積り表示 + Linear 同期ウィジェット
├── lib/
│   ├── ai/                 # Claude / Grok クライアント + システムプロンプト
│   ├── approval/           # 承認ゲート + Go/No-Go 評価
│   ├── estimates/          # 自動見積り + モジュール分解 + 類似案件検索
│   ├── github/             # リポジトリ発見 + Velocity 分析
│   ├── linear/             # Linear SDK クライアント + 同期 + Webhook 検証
│   ├── market/             # 市場エビデンス (Grok + フォールバック)
│   ├── pricing/            # 価格エンジン + ポリシー管理
│   ├── intake/             # Intake パイプライン
│   └── utils/              # レート制限, 構造化ログ, env 検証
├── types/                  # TypeScript 型定義 (database.ts = SSOT)
└── test/                   # テストセットアップ
```

## 主要画面

| パス | 対象 | 機能 |
|------|------|------|
| `/dashboard` | 顧客 | プロジェクト一覧・新規作成 |
| `/projects/[id]/chat` | 顧客 | AI ヒアリングチャット |
| `/projects/[id]` | 顧客 | 仕様書・見積り閲覧 |
| `/admin` | 管理者 | ダッシュボード（全案件俯瞰） |
| `/admin/projects/[id]` | 管理者 | 案件詳細 + 見積り調整 + Linear 同期 |
| `/admin/github` | 管理者 | GitHub リポジトリ管理 |

## API エンドポイント（主要）

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
- `lint` → `type-check` → `unit-tests` (coverage) → `migration-check` → `build` → `e2e-smoke`

### CD (`.github/workflows/cd.yml`)

- `main` push 時に Vercel 自動デプロイ（シークレット設定時）

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
