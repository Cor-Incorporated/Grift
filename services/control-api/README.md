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
- `AUTH_DISABLED=true`: local 開発用の auth bypass。tenant middleware と DB wiring は有効のまま。

## Mock event publisher

Observation Pipeline 統合テスト向けに `conversation.turn.completed` を発行する CLI:

```bash
cd services/control-api
go run ./cmd/mock-conversation-event
go run ./cmd/mock-conversation-event -publish -project-id <gcp-project-id>
```
