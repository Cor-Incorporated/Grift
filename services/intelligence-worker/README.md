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
- `LLM_GATEWAY_URL`: structured extraction を委譲する `llm-gateway` の base URL。

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
