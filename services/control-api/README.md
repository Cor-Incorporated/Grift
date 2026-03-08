# services/control-api

v2 の Go control plane。

責務:

- 認証 / 認可
- tenant context 解決
- Case / Proposal / Approval / Handoff API
- GitHub / Linear webhook 受信
- outbox 発行

内部知能処理は `services/intelligence-worker` と `services/llm-gateway` に委譲する。
