# BenevolentDirector v2 プラットフォーム bootstrap

最終更新: 2026-03-08

## 1. 目的

v2 の実装を始める前に、GCP / Firebase / GitHub App / Linear の前提を固定する。  
この文書は「あとで決める」を減らし、Phase 0 を止めないための bootstrap 手順書である。

## 2. 前提

- v2 の root は monorepo 前提で構築する
- v1 は参照実装として別退避する
- `.env.local` は repo root に残し、v1 アーカイブ対象に含めない
- 本番の secret は GCP Secret Manager に置くが、ローカル開発では `.env.local` を使用する

## 3. 必須システム

### GCP

- `GOOGLE_CLOUD_PROJECT`
- `CLOUDSQL_CONNECTION_NAME`
- `CLOUDSQL_DB_USER`
- `CLOUDSQL_DB_PASSWORD`
- `CLOUDSQL_DB_NAME`
- `GCS_BUCKET_DOCUMENTS`
- `PUBSUB_PROJECT_ID`

役割:

- Cloud SQL: OLTP / pgvector
- GCS: 顧客資料原本、抽出成果物
- Pub/Sub: Domain Event / 非同期処理
- BigQuery: Operational Intelligence / 評価 / 補正値
- GKE: `Qwen3.5` 推論
- Cloud Run: `web` / `control-api` / `intelligence-worker`

### Firebase / Google Identity Platform

- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_SERVICE_ACCOUNT_KEY`

役割:

- テナント横断の認証
- web / 将来の Slack app / mobile app で共通利用

### GitHub App

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_WEBHOOK_SECRET`

権限の最小要件:

- Repository metadata: read
- Contents: read
- Pull requests: read
- Issues: read / write
- Organization members: read
- Webhooks: read

### Linear

- `LINEAR_API_KEY`
- `LINEAR_WEBHOOK_SECRET`
- `LINEAR_DEFAULT_TEAM_ID`

役割:

- ビジネス SSOT
- Proposal 承認後の project / issue handoff

### 外部 AI / 検索

- `ANTHROPIC_API_KEY`
- `XAI_API_KEY`
- `BRAVE_SEARCH_API_KEY`
- `PERPLEXITY_API_KEY`
- `GEMINI_API_KEY`

役割:

- Market Benchmark Context
- citation 必須の外部検索
- Qwen3.5 fallback ではなく、根拠付きクラウド知能として扱う

## 4. bootstrap チェックリスト

### GCP

1. v2 専用 project を固定する
2. Terraform state backend を固定する
3. Cloud SQL / GCS / Pub/Sub / BigQuery / GKE の naming を確定する
4. budget alert と quota alert を入れる
5. Secret Manager の命名規約を決める

### Firebase

1. v2 専用 project を有効化する
2. web client 用ドメインを登録する
3. service account を発行する
4. custom claims の role マッピング方針を固定する

### GitHub App

1. callback URL を v2 用に更新する
2. webhook URL を `control-api` の `/v1/webhooks/github` に向ける
3. Organization installation の接続先を確認する
4. webhook secret を root `.env.local` と Secret Manager に同期する

### Linear

1. team / workflow / labels の最小集合を決める
2. webhook URL を `control-api` の `/v1/webhooks/linear` に向ける
3. default team id を固定する

## 5. ローカル開発ルール

- `.env.local` は repo root に置く
- `v1/` 退避時も `.env.local` は移動しない
- `.env.local` の内容は commit しない
- 実装着手前に `npm run ci:v2:env` を通す

## 6. GitHub Actions に入れるもの

CI に必須で入れる:

- `ci:v2:openapi`
- `ci:v2:schema`
- `ci:v2:monorepo`

手動またはローカルで確認する:

- `ci:v2:env`

`ci:v2:env` は secret 値そのものではなく、必要キーの存在と placeholder 残りを確認する。

## 7. 成功条件

以下が揃ったら Phase 0 の bootstrap は完了とみなす。

- 必須 env が `.env.local` で満たされる
- GitHub App / Linear webhook secret が確定している
- GCP project / Terraform backend / budget が確定している
- Firebase 認証基盤が確定している
- これらの前提が repo 内文書に記録されている
