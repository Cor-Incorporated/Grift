# services/llm-gateway

v2 の LLM anti-corruption layer。

責務:

- OpenAI 互換 API 提供
- `Qwen3.5` へのローカル推論ルーティング
- 外部クラウド LLM への fallback
- redaction / prompt logging / provider policy 適用

アプリケーションは provider 固有 API を直接呼ばない。
