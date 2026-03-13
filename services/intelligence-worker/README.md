# services/intelligence-worker

v2 の Python intelligence plane。

責務:

- Deep Ingestion
- embedding / retrieval
- Market Benchmark orchestration
- Evidence aggregation
- 非同期評価 / 補正値更新
- Extractor プラグイン実行（初期: EstimationExtractor）
- QA Pair quality scoring（confidence / completeness / coherence）
- QA Pair 抽出（LLM Structured Output）

同期 API は持たず、Pub/Sub と DB 契約経由で動く。

## Environment

- `DATABASE_URL`: PostgreSQL 接続文字列。
- `PUBSUB_PROJECT_ID`: subscribe 対象の GCP project。
- `PUBSUB_SUBSCRIPTION`: subscription 名。未指定時は `conversation-turn-completed-sub`。
- `MARKET_PUBSUB_SUBSCRIPTION`: `market.research.requested` を consume する subscription 名。未指定時は `market-research-requested-sub`。
- `PUBSUB_TOPIC`: completeness 更新イベント publish 先 topic 名。未指定時は `conversation-turns`。
- `LLM_GATEWAY_URL`: structured extraction を委譲する `llm-gateway` の base URL。
- `CONTROL_API_URL`: `cases.type` 同期先の `control-api` base URL。未指定時は `http://localhost:8080`。
- `CONTROL_API_TOKEN`: `control-api` PATCH に使う bearer token。未設定だと Authorization ヘッダーは送らない。
- `GROK_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`: market intelligence provider credentials。
  `XAI_API_KEY` と `BRAVE_SEARCH_API_KEY` は互換 alias として読まれるが、今後の canonical 名は `GROK_API_KEY` / `BRAVE_API_KEY`。
- `MARKET_PROVIDER_TIMEOUT_SECONDS`: provider ごとの timeout 秒数。既定値は `30`。
- `MARKET_PROVIDER_MAX_RETRIES`: provider ごとの retry 回数。既定値は `2`。
- `STRUCTURED_OUTPUT_MODEL`: QA extraction / requirement artifact 生成に使う `llm-gateway` モデル。既定値は `qwen3.5-7b`。
- `INTENT_CLASSIFIER_MODEL`: intent classification に使う `llm-gateway` モデル。既定値は `qwen3.5-9b`。
- `DEAD_LETTER_MAX_RETRIES`: dead-letter の retry metadata を計算する最大回数。既定値は `3`。

## DLQ replay CLI

Observation Pipeline の DLQ メッセージを手動で元 topic に再投入するスクリプト:

```bash
./services/intelligence-worker/scripts/replay-dlq.sh \
  --project <gcp-project-id> \
  --topic conversation-turns \
  --env dev \
  --max-messages 50
```

- DLQ subscription: `bd-<env>-<topic>-dlq-sub`
- original topic: `bd-<env>-<topic>`
- 1 件ずつ pull -> publish -> ack の順で再処理する
- worker 内の DB retry metadata も `1m -> 5m -> 30m` で進み、`DEAD_LETTER_MAX_RETRIES` 超過時は `resolved_at` を失敗扱いで埋める
