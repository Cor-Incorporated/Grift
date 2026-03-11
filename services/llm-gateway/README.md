# services/llm-gateway

v2 の LLM anti-corruption layer。

責務:

- OpenAI 互換 API 提供
- `Qwen3.5` へのローカル推論ルーティング
- 外部クラウド LLM への fallback
- redaction / prompt logging / provider policy 適用

アプリケーションは provider 固有 API を直接呼ばない。

## Streaming interface

- `POST /v1/chat/completions` は `stream=true` の場合 `application/x-ndjson` を返す
- チャンク型: `content` / `error` / `done`
- `stream=false`（デフォルト）は buffered JSON レスポンスを返す
- `X-Data-Classification` ヘッダーは `public|internal|confidential|restricted`
  - ヘッダー未指定・無効値は `restricted` として扱う（fail-closed）

## Fallback chain

`/v1/chat/completions` は ADR-0014 準拠の 3 段フォールバックを実装:

1. 同一モデル別ノード (`secondary`)
2. 軽量モデルダウングレード (`lightweight`)
3. OpenRouter クラウドエスケープ (`last_resort`)

設定は `packages/config/llm-gateway-fallback-chain.stub.json` で管理し、
`LLM_GATEWAY_FALLBACK_CHAIN_CONFIG` で差し替え可能。

メトリクスは `GET /metrics/fallbacks` で取得できる。
