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
