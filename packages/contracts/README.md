# packages/contracts

v2 の contract-first SSOT を置く。

- `openapi.yaml`: HTTP API 契約
- `initial-schema.sql`: Cloud SQL 初期 DDL と RLS ガードレール

実装前にここを更新し、CI の `ci:v2:openapi` / `ci:v2:schema` を通す。
