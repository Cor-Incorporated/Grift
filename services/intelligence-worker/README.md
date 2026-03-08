# services/intelligence-worker

v2 の Python intelligence plane。

責務:

- Deep Ingestion
- embedding / retrieval
- Market Benchmark orchestration
- Evidence aggregation
- 非同期評価 / 補正値更新

同期 API は持たず、Pub/Sub と DB 契約経由で動く。
