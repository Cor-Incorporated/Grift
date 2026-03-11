# services/control-api

v2 の Go control plane。

責務:

- 認証 / 認可
- tenant context 解決
- Case / Proposal / Approval / Handoff API
- GitHub / Linear webhook 受信
- outbox 発行

内部知能処理は `services/intelligence-worker` と `services/llm-gateway` に委譲する。

## Mock event publisher

Observation Pipeline 統合テスト向けに `conversation.turn.completed` を発行する CLI:

```bash
cd services/control-api
go run ./cmd/mock-conversation-event
go run ./cmd/mock-conversation-event -publish -project-id <gcp-project-id>
```
