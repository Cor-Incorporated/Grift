# BenevolentDirector v2 テスト戦略

最終更新: 2026-03-08

## 1. 目的

v2 では「テストを書く」こと自体を目的にしない。  
目的は、以下のガードレールを CI 上で機械的に強制することにある。

- テナント境界を壊さない
- 外部副作用を二重実行しない
- OpenAPI と実装を乖離させない
- migration が本番投入可能な状態を保つ
- Qwen3.5 / クラウド LLM の切り替えで回帰を起こさない

## 2. 原則

### Contract-first

- API は `packages/contracts/openapi.yaml` を先に更新する
- DB は `packages/contracts/initial-schema.sql` または migration を先に更新する
- 実装はその後に行う

### Test-first for risky changes

以下は必ず失敗するテストを先に書く。

- tenant isolation
- webhook duplicate / replay
- idempotent handoff
- append-only table protection
- pricing / go-no-go の判定ロジック

### Smallest useful test set

同じバグを 3 層で重複して検証しない。  
境界ごとに最小のテストで保証する。

## 3. テストレイヤー

### 3.1 Contract tests

対象:

- OpenAPI
- request / response schema
- error response
- required headers / required fields

必須項目:

- `openapi.yaml` が構文的に有効
- 全 endpoint が共通 error response を持つ
- tenant-scoped endpoint にだけ `X-Tenant-ID` が付く
- 外部副作用 endpoint は `idempotency_key` を要求する

### 3.2 Migration / schema tests

対象:

- SQL migration
- RLS
- role grants
- trigger
- index

必須項目:

- 全 tenant table に `tenant_id`, `ENABLE RLS`, `FORCE RLS`
- append-only table に `UPDATE/DELETE` 権限がない
- internal table の grant が最小権限
- updated_at trigger が対象テーブルに付いている

### 3.3 Repository / service tests

対象:

- Go repository
- Python service
- Evidence Aggregator
- ChangeClassification
- GoNoGo

必須項目:

- happy path
- invalid input
- permission failure
- duplicate event / duplicate handoff

### 3.4 Integration tests

対象:

- API ↔ Cloud SQL
- API ↔ Pub/Sub emulator
- webhook receipt → outbox / processed events
- llm-gateway routing

必須項目:

- tenant A のデータを tenant B が読めない
- duplicate webhook で副作用が増えない
- replay 実行で同一 handoff が再作成されない
- unresolved webhook receipt が通常ユーザーに見えない

### 3.5 End-to-end tests

対象:

- intake → requirement artifact
- estimate → proposal
- approval → handoff
- project outcome recording

必須項目:

- 代表ユースケースが通る
- UI に引用元とエラー状態が表示される

### 3.6 Model evaluation tests

対象:

- Qwen3.5-9B
- Qwen3.5-35B-A3B
- クラウド LLM fallback

必須項目:

- intent classification accuracy
- requirement extraction accuracy
- latency
- citation consistency
- local vs cloud comparison

## 4. CI 必須ゲート

PR を通す最低条件は以下。

1. OpenAPI lint / validation
2. SQL schema smoke test
3. unit tests
4. contract tests
5. tenant isolation tests
6. webhook duplicate / replay tests
7. representative e2e

現時点で repo に追加済みの自動ゲート:

- `npm run ci:v2:openapi`
- `npm run ci:v2:schema`
- `npm run ci:v2:monorepo`
- `npm run ci:v2:env`（ローカル / 手動実行）

main マージ前に追加で必要:

1. migration apply test
2. llm-gateway routing integration test
3. Qwen benchmark smoke

## 5. Definition of Done

### 新規 endpoint

- OpenAPI 更新済み
- 成功系テストあり
- 401 / 403 / 400 のどれかが検証済み
- tenant-scoped なら isolation test あり
- 外部副作用ありなら idempotency test あり

### 新規 tenant table

- `tenant_id` あり
- RLS 有効
- FORCE RLS 有効
- grant 最小化済み
- tenant cross-read test あり

### 新規 webhook consumer

- signature verification test あり
- duplicate delivery test あり
- replay test あり
- DLQ or failure handling を確認済み

### 新規 LLM routing

- `llm-gateway` 経由
- restricted data path test あり
- fallback test あり
- prompt logging / redaction を確認済み

## 6. 推奨ディレクトリ

```text
packages/contracts/tests/
  openapi/
  schema/

services/control-api/tests/
  unit/
  integration/
  e2e/

services/intelligence-worker/tests/
  unit/
  integration/

services/llm-gateway/tests/
  routing/
  benchmark/
```

## 7. 最優先テスト一覧

v2 着工直後に最初に作るべきもの:

1. tenant A / tenant B cross-read failure test
2. `conversation_turns` append-only permission test
3. handoff idempotency test
4. duplicate GitHub webhook replay test
5. unresolved webhook receipt visibility test
6. OpenAPI tenant header scope test

## 8. この文書の位置づけ

この文書は「TDD をやるべき」という精神論ではない。  
`docs/v2` で定義した ADR 群を、CI 上で壊せないようにするための実務ルールである。
