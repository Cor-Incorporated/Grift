# services/control-api

v2 の Go control plane。

責務:

- 認証 / 認可
- tenant context 解決
- Case / Proposal / Approval / Handoff API
- GitHub / Linear webhook 受信
- outbox 発行

内部知能処理は `services/intelligence-worker` と `services/llm-gateway` に委譲する。

## Environment

- `DATABASE_URL`: PostgreSQL 接続文字列。server 起動時に必須。
- `LLM_GATEWAY_URL`: `llm-gateway` の base URL。未指定時は `http://localhost:8081`。
- `PUBSUB_PROJECT_ID`: `conversation.turn.completed` を Pub/Sub に発行する GCP project。未指定時は publish をスキップ。
- `PUBSUB_TOPIC`: Pub/Sub topic 名。未指定時は `conversation-turns`。
- `MARKET_PUBSUB_TOPIC`: `market.research.requested` を publish する topic 名。未指定時は `market-research`。
- `AUTH_DISABLED=true`: local 開発用の auth bypass。tenant middleware と DB wiring は有効のまま。

`POST /v1/market-evidence` は `job_id` を返す。この値は後続の `GET /v1/market-evidence/{evidenceId}` で参照する `aggregated_evidences.id` と同一で、worker 側が同じ ID で結果を書き戻す。

## Mock event publisher

Observation Pipeline 統合テスト向けに `conversation.turn.completed` を発行する CLI:

```bash
cd services/control-api
go run ./cmd/mock-conversation-event
go run ./cmd/mock-conversation-event -publish -project-id <gcp-project-id>
```
