# ADR-0014: llm-gateway は NDJSON Streaming-First + vLLM OpenAI 互換 API を内部標準とする

## ステータス

提案

## 日付

2026-03-11

## コンテキスト

v2 では Estimation Domain と Research Domain を統合したプロダクトを構築する。両ドメインとも会話ストリーミング、Observation Pipeline への非同期データフロー、ローカル LLM (Qwen3.5) の推論結果配信を必要とする。

ストリーミング戦略として SSE (Server-Sent Events) と NDJSON (Newline Delimited JSON) の 2 つの選択肢がある。また、llm-gateway のインターフェースとして独自プロトコルと OpenAI 互換 API の選択肢がある。

一次情報として確認できる事項は以下。

- vLLM は OpenAI 互換 API (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`) を標準で提供する
- HuggingFace TGI も `/v1/chat/completions` で OpenAI 互換 API を提供し、`"stream": true` でストリーミングレスポンスを返す
- TGI は OpenAI Python クライアントや `huggingface_hub.InferenceClient` でそのまま接続可能
- NDJSON の MIME type は `application/x-ndjson`、各行が独立した JSON テキストで `\n` 区切り
- GCP Pub/Sub は at-least-once delivery を保証し、メッセージスキーマ検証（Avro / Protocol Buffers）と ordering key によるテナント単位のメッセージ順序保証をサポートする（ordering key は同一キー内の順序制御であり、テナント間のデータ分離ではない）（コンシューマー側の冪等処理は ADR-0009 で規定）
- Polls（前身システム）では SSE を後付けで導入し、`execute()` と `execute_streaming()` の二重実装が発生した

## 決定

### 1. NDJSON Streaming-First

すべての AI レスポンス API は NDJSON ストリームを第一級で返す。非ストリーミングはストリームのバッファリングとして実装する。

```text
Content-Type: application/x-ndjson
Transfer-Encoding: chunked

{"type":"content","text":"プロジェクトの"}
{"type":"content","text":"技術スタックを"}
{"type":"content","text":"教えてください"}
{"type":"error","code":"model_timeout","fallback":true}
{"type":"done","metadata":{"tokens":150,"model":"qwen3.5-32b","latency_ms":1200}}
```

SSE ではなく NDJSON を選択する理由:

1. ローカル LLM との整合性 — vLLM も TGI も OpenAI 互換ストリーミングで SSE 形式（`data:` プレフィックス付き）を返す。llm-gateway が SSE → NDJSON の変換を 1 箇所で行い、下流の全コンシューマーは NDJSON のみを扱う。変換点が単一の境界に集約されるのが利点
2. Observation Pipeline との統合 — 会話ストリームをそのまま Pub/Sub に流して非同期処理するには NDJSON が自然。SSE だと `data:` プレフィックスの除去が毎回必要
3. サーバー間通信 — SSE はブラウザ向け設計。サービス間（control-api → intelligence-worker）の通信には NDJSON が適する
4. エラーハンドリング — チャンク単位でエラー型を送信できる。SSE では `event: error` を送信可能だが、サーバー間通信でのパーサー実装コストがある
5. 二重実装の回避 — Polls 教訓として `execute()` / `execute_streaming()` の並存を排除する

### 2. OpenAI 互換 API を内部標準とする

llm-gateway は独自プロトコルを持たず、OpenAI 互換 API を内部標準にする。ただし「内部標準」とは **上流**（llm-gateway ↔ vLLM/TGI）のインターフェースを指す。上流では OpenAI 互換 API をそのまま使用し、`stream=false` 時は単一 JSON、`stream=true` 時は SSE (`data:` プレフィックス) で通信する。**下流**（llm-gateway → control-api 等のコンシューマー）では、セクション 1 の NDJSON Streaming-First 原則に従い、ストリーミング時は SSE → NDJSON 変換を llm-gateway が行い、非ストリーミング時は通常の JSON レスポンスを返す。

```text
POST /v1/chat/completions    ← 会話・生成（ストリーミング対応）
POST /v1/embeddings          ← embedding 生成（pgvector 用）
GET  /v1/models              ← 利用可能モデル一覧
GET  /health                 ← llm-gateway + backend 健全性
GET  /metrics                ← Prometheus 形式
```

llm-gateway が担当する機能:

- ルーティング（`model` パラメータ → backend URL への解決）
- フォールバック（timeout / OOM → 次候補への切り替え）
- メトリクス（latency, tokens, error rate, fallback rate）
- Rate Limit（テナント単位、`X-Tenant-ID` ヘッダー）
- Request/Response ログ（Observation Pipeline 用）

llm-gateway が担当しない機能:

- モデル固有のプロンプト加工（各ドメインサービスの責務）
- Structured Output の強制（Observation 層の責務、ADR-0015 参照）
- セッション管理（各ドメインサービスの責務）

### 3. フォールバック戦略

Polls では「Grok タイムアウト → 間違ったモデルにフォールバック」で 70% の成功率だった。明示的な 3 段フォールバックチェーンを定義する。

```yaml
routes:
  - model: "qwen3.5-32b"
    backends:
      - url: "http://vllm-primary:8000"
        timeout: 30s
      - url: "http://vllm-secondary:8000"
        timeout: 30s
    fallback:
      model: "qwen3.5-7b"
      timeout: 15s
    last_resort:
      provider: "openrouter"
      model: "qwen/qwen-2.5-72b-instruct"
      timeout: 60s
```

段階:

1. 同一モデルの別ノード（GPU 障害への耐性）
2. 軽量モデルへの降格（OOM / 過負荷への耐性）
3. クラウド API へのエスケープ（クラスタ全体障害への耐性）

フォールバック発動時は `X-Fallback-Used: true` ヘッダーで呼び出し側に通知する。

制約: `last_resort` のクラウドフォールバックは Restricted データを含むリクエストには適用しない。ADR-0001 のデータ分類に基づき、llm-gateway のルーティング層で Restricted / Non-Restricted を区別する。Restricted リクエストのフォールバックは同一クラスタ内の軽量モデルまでに限定する。

### 4. ストリーム中断時の方針

ストリーム途中で backend が死んだ場合は、エラーチャンクを送信してクライアントに再リクエストさせる（案 A）。

```json
{"type":"error","code":"stream_interrupted","retry":true}
```

llm-gateway 内でバッファリングしてフォールバック先に切り替える案（案 B）は採用しない。Polls の「6 層防御コード」の再来になるリスクがある。クライアント側で再試行ロジックを 1 箇所に持つ方が保守しやすい。

### 4.5. 公開 API と内部 API の境界

NDJSON は llm-gateway の内部契約およびサーバー間通信の標準とする。

```text
ブラウザ (React)
    ↓ NDJSON (fetch + ReadableStream)
control-api (:8080)
    ↓ NDJSON (サーバー間)
llm-gateway (:8081)
    ↓ SSE → NDJSON 変換 (1 箇所)
vLLM (:8000)
```

公開 API（`/v2/conversations/stream` 等）も NDJSON (`application/x-ndjson`) で統一する。現行 `openapi.yaml` の `text/event-stream` は Phase 2 実装時に `application/x-ndjson` に更新する（Issue #143）。

これにより SSE と NDJSON の二重契約を回避する。openapi.yaml の更新は contract-first 原則に基づき、実装前に行う。

### 4.6. Restricted データの redaction

llm-gateway は `last_resort` クラウドフォールバック発動前に以下を実行する:

1. リクエストの `X-Data-Classification` ヘッダーを検査
2. Restricted データを含む場合はクラウドフォールバックを拒否（同一クラスタ内のみ）
3. Non-Restricted データの場合でも、送信前に redaction ルールを適用
4. フォールバック発動・redaction 適用を監査ログに記録

**Fail-closed デフォルトポリシー（セキュリティ要件）:**

- `X-Data-Classification` ヘッダーが**存在しない**場合、llm-gateway は当該リクエストを **Restricted として扱い**、クラウドフォールバックを拒否する（fail-closed）。ヘッダー未指定をデフォルト許可にすると、呼び出し側の実装漏れで Restricted データがクラウドに送信されるリスクがある
- llm-gateway は `X-Data-Classification` ヘッダーの値を**サーバーサイドで検証**する。呼び出し側が供給した値を無検証で信頼してはならない。具体的には、テナントポリシー（`packages/config` で管理）と照合し、当該テナント・エンドポイントの組み合わせで許可された分類レベルであることを確認する
- **本番実装では、データ分類をリクエストヘッダーのみに依存しない。** テナントポリシーとリクエストペイロードのコンテンツ検査（PII 検出・機密パターンマッチ等）を組み合わせてサーバーサイドで分類を導出すべきである。`X-Data-Classification` ヘッダーはヒントとして利用するが、最終的なゲート判定はサーバーサイドの検証結果に基づく

redaction ルールは `packages/config` で管理し、per-request で適用する。

### 4.7. Contract-First 整合

本 ADR は設計方針の文書化であり、契約ファイル（`packages/contracts/openapi.yaml`, `packages/contracts/initial-schema.sql`）の変更は含まない。現時点で `openapi.yaml` のストリーミングエンドポイントは `text/event-stream` のままであり、`initial-schema.sql` には本 ADR で言及するメトリクス・フォールバック関連のカラムが未定義である。これらの SSOT 更新は Phase 2 実装着手前に contract-first 原則に基づき先行して行う（Issue #143 で追跡中）。

### 5. HuggingFace 統合の位置づけ

vLLM をサービングレイヤーに統一し、HuggingFace をモデルレジストリとして使う。

```text
HuggingFace Hub (モデル取得)
    ↓ vllm --model hf://Qwen/Qwen3.5-32B
vLLM Serving (推論実行、OpenAI 互換 API)
    ↓ POST /v1/chat/completions
llm-gateway (:8081) (ルーティング・フォールバック・メトリクス)
    ↓
各ドメインサービス
```

vLLM は `--model` に HuggingFace のモデル ID をそのまま渡せる。新しいモデルを試すときは vLLM の起動パラメータを変えるだけで、llm-gateway 側のコード変更は不要。

## 理由

### NDJSON の根拠

NDJSON 仕様（`application/x-ndjson`）は各行が独立した JSON テキストで、ストリームプロトコル上での複数 JSON インスタンス配信に適している。vLLM / TGI の OpenAI 互換ストリーミングレスポンスは SSE 形式（`data:` プレフィックス付き）であり、llm-gateway が SSE → NDJSON の変換を 1 箇所で行う。これにより下流の全コンシューマーは NDJSON のみを扱えばよく、変換点が分散しない。

### OpenAI 互換の根拠

vLLM と TGI の両方が `/v1/chat/completions` を提供している。TGI は OpenAI Python クライアント (`openai.OpenAI(base_url="http://localhost:8080/v1/")`) でそのまま接続可能。独自プロトコルを作ると、これらとの間に不要な変換層が生じる。

### フォールバック戦略の根拠

Polls のフォールバック失敗（誤ったモデルへの切り替え、timeout 設定のカスケード）は、フォールバックチェーンが暗黙的だったことに起因する。明示的な 3 段チェーンと段階ごとの timeout により再発を防ぐ。

## 結果

### 良い結果

- vLLM / TGI との間の SSE → NDJSON 変換が llm-gateway の 1 箇所に集約される
- ストリーミングと非ストリーミングの二重実装が不要
- 新規モデルの追加が vLLM 起動パラメータの変更のみ
- Observation Pipeline がストリームをそのまま消費可能

### 悪い結果

- ブラウザクライアントでは `EventSource` が使えず `fetch` + `ReadableStream` が必要
- NDJSON パーサーをクライアント側で実装する必要がある（ただし 10-20 行程度）
- OpenAI 互換に縛られるため、独自の最適化パラメータは `extra_body` 経由になる

## 代替案

### 代替案 A: SSE を採用する

却下理由:

- vLLM / TGI のネイティブ SSE 形式をそのまま使うと、各コンシューマーで SSE パースが必要になり変換点が分散する
- サーバー間通信に不向き
- Polls で SSE 後付けによる二重実装が問題になった

### 代替案 B: 独自プロトコルを設計する

却下理由:

- vLLM / TGI との変換層が 2 重になる
- クライアントライブラリの再実装が必要
- OpenAI 互換エコシステムの恩恵を受けられない

## 関連 ADR

- ADR-0001: ローカル LLM とクラウド LLM の境界
- ADR-0011: Qwen3.5 の GCP ホスティング戦略（llm-gateway の責務定義）
- ADR-0015: Observation Pipeline の非同期 QA 抽出設計

## 一次情報

- vLLM OpenAI Compatible Server
  - https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html
- HuggingFace TGI, Consuming TGI
  - https://huggingface.co/docs/text-generation-inference/en/basic_tutorials/consuming_tgi
- NDJSON Specification
  - https://github.com/ndjson/ndjson-spec
- Google Cloud Pub/Sub Overview
  - https://cloud.google.com/pubsub/docs/overview
