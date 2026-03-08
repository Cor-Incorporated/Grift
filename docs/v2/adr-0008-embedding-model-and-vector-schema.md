# ADR-0008: 生成モデルと埋め込みモデルを分離し、ベクトルスキーマをバージョン管理する

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v2 の Deep Ingestion と RAG は、以下の要素に依存する。

- PDF / URL / ZIP の chunking
- embedding 生成
- pgvector 検索
- Requirement Artifact への引用反映

既存文書では embedding について `Qwen3.5 or OpenAI Embedding` のように表現が揺れている。これは以下の問題を生む。

- 生成モデルと埋め込みモデルの責務が混ざる
- ベクトル次元が固定されず、インデックス設計がぶれる
- モデル切り替え時に既存データとの互換性が壊れる
- namespace ごとの検索品質を管理できない

RAG の品質は「どの生成モデルを使うか」より、「どの embedding family と chunk schema を固定するか」に強く依存する。ここは明示的に固定する必要がある。

## 決定

v2 では、生成モデルと埋め込みモデルを分離する。

### 1. Qwen3.5 は生成系に限定する

`Qwen3.5` は以下に使う。

- 意図分類
- 要約
- Requirement Artifact 下書き
- 内部向け整理

本番の production retrieval index に対する embedding 生成には使わない。

### 2. 埋め込みは専用 provider abstraction で扱う

`EmbeddingProvider` を独立インターフェースとして定義する。

```text
Embed(texts[], namespace, embedding_model_version) -> vectors[]
```

アプリは provider 名を直接扱わず、`embedding_model_version` だけを見る。

### 3. namespace ごとに単一の embedding family を使う

同一 namespace では、1 つの active embedding family だけを使う。

初期 namespace:

- `customer_docs`
- `case_memory`
- `repo_intelligence`
- `requirement_artifacts`

禁止事項:

- 同じ namespace に複数次元の vector を混在させること
- query 側と document 側で別モデルを混在させること

### 4. ベクトルスキーマを version 管理する

最低限、以下を保持する。

```text
DocumentChunk
├─ id
├─ tenant_id
├─ namespace
├─ source_type
├─ source_id
├─ chunk_index
├─ content
├─ content_sha256
├─ token_count
├─ metadata_json
├─ chunk_version
└─ created_at

ChunkEmbedding
├─ id
├─ tenant_id
├─ chunk_id
├─ namespace
├─ embedding_model_version
├─ embedding_dimensions
├─ vector
├─ embedded_at
└─ is_active
```

### 5. 再 embedding はバージョンを上げて行う

embedding model を切り替えるときは上書きしない。

- 新しい `embedding_model_version` を発行する
- backfill ジョブで再 embedding する
- 検索 API の active version を切り替える
- 旧 version は一定期間残してから削除する

### 6. 検索 API の契約

検索側は必ず namespace と active version を指定して実行する。

```text
Search(namespace, tenant_id, query_embedding, top_k, filters)
```

### 7. 引用整合性

Requirement Artifact や UI に表示する引用は、chunk 単位で追跡できるようにする。

必須メタデータ:

- `source_id`
- `chunk_index`
- `offset_start`
- `offset_end`
- `content_sha256`

## 理由

### 互換性

embedding の切り替えを安全に行える。

### 品質管理

namespace ごとに検索品質を比較しやすくなる。

### 責務分離

Qwen3.5 の採用判断と embedding の採用判断を切り離せる。

## 結果

### 良い結果

- RAG の再現性が上がる
- モデル切り替え時の破壊的変更を避けられる
- どの vector がどのモデル由来か追跡できる

### 悪い結果

- 初期スキーマが少し増える
- 再 embedding のバックフィル運用が必要になる
- namespace 設計を先に決める必要がある

## 代替案

### 代替案 A: Qwen3.5 をそのまま embedding にも使う

却下理由:

- 生成と検索の責務が混ざる
- 本件の一次情報だけでは production embedding の前提が十分に固まらない
- embedding の評価軸が曖昧になる

### 代替案 B: コンテキストごとに好きな embedding provider を使う

却下理由:

- 検索品質の比較ができない
- インデックス運用が壊れる
- 実装者ごとに判断が割れる

## 関連 ADR

- ADR-0001: Qwen3.5 は主に生成系に使う
- ADR-0007: vector tables も tenant 境界の対象にする
- ADR-0010: 埋め込みデータの保持期間と削除方針を定義
