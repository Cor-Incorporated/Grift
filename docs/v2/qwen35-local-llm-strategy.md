# Qwen3.5 ローカル LLM 戦略

最終更新: 2026-03-08

## 1. この文書の目的

`Qwen3.5` の公式 GitHub README を一次情報として、BenevolentDirector v2 でどのモデルをどう使うかを定義する。

## 2. 一次情報から確認できる事実

2026-03-08 時点で確認できた内容は以下。

- リポジトリ名は `Qwen3.5`
- 2026-02-16 に最初の Qwen3.5 を公開
- 初回公開モデルは `397B-A17B` MoE
- 2026-02-24 に `122B-A10B`、`35B-A3B`、`27B` を追加
- 2026-03-02 に `9B`、`4B`、`2B`、`0.8B` を追加
- multimodal を前面に出している
- 201 言語 / 方言対応を強調している
- OpenAI 互換 API でのサービング例がある
- `transformers`、`SGLang`、`vLLM`、`llama.cpp`、`mlx` が README 内で案内されている
- ライセンスは Apache 2.0

## 3. BenevolentDirector への適合性

### 3.1 適している点

- OpenAI 互換 API で扱えるため、アプリ側の契約を固定しやすい
- 小型から大型まで複数サイズがあり、用途別ルーティングがしやすい
- multimodal を前提にしているため、将来の PDF / 画像資料対応を一本化しやすい
- Apache 2.0 のため、商用プロダクト内でのセルフホストがしやすい

### 3.2 注意点

- User Guide は README 時点で `coming soon`
- ベンチマーク詳細は README 本文よりも release blog / model card 参照が前提
- 実運用の GPU 要件や VRAM 見積は README 単体では不足している

したがって、v2 では「モデル採用判断」と「インフラ最終確定」は分ける。

## 4. 役割別モデル方針

### 4.1 推奨用途

| 用途 | モデル方針 | 理由 |
|------|-----------|------|
| 開発者ローカル検証 | `0.8B` / `2B` / `4B` | 低コスト、素早い反復 |
| ステージングの分類・要約 | `9B` | 実用性とコストの均衡 |
| 本番の主要ヒアリング補助 | `27B` または `35B-A3B` | 精度とレイテンシのバランス候補 |
| 高難度の内部検討 | `122B-A10B` 以上 | まずは常用しない。必要時のみ |

### 4.2 v2 の初期採用

MVP では次の 2 系統から始める。

- `Qwen3.5-9B`
  - 分類
  - 要約
  - 軽量な質問案生成
- `Qwen3.5-35B-A3B`
  - Requirement Artifact 初稿
  - ヒアリング下書き
  - Deep Ingestion 後の内部向け整理

これは README に明記された公開済みサイズの中で、開発運用しやすさと本番利用のバランスがよいためである。

## 5. サービング方針

### 5.1 ローカル開発

README にある手段をそのまま使い分ける。

- Apple Silicon:
  - `mlx-lm`
  - `mlx-vlm`
- CPU / 軽量検証:
  - `llama.cpp`
- 汎用開発:
  - `transformers serve`

### 5.2 本番 / 検証環境

README では `SGLang` と `vLLM` が deployment として明示されているため、v2 の本番候補もこの 2 つに限定する。

推奨順位:

1. `vLLM`
2. `SGLang`

理由:

- どちらも OpenAI 互換 API を出せる
- README 内で `reasoning-parser qwen3` 付きの起動例がある
- モデル差し替え時にアプリ側の変更を減らせる

### 5.3 GCP でのホスティング優先順位

v2 では以下の優先順位を採用する。

1. GKE + vLLM
2. Vertex AI Model Garden self-deployed
3. Cloud Run GPU

理由:

- GKE は Google Cloud 側に open model serving の reference architecture がある
- Vertex self-deployed は project / VPC 内に安全に載せられる
- Cloud Run GPU は scale to zero が強く、9B 系の軽量補助に向く

制約:

- Vertex の model availability は model card 依存
- Cloud Run GPU は 1 GPU / instance のため、主力経路にはしない

詳細は ADR-0011 を参照。

## 6. 推論 API 契約

アプリケーションは Qwen 固有 API を直接呼ばない。`llm-gateway` が OpenAI 互換インターフェースを提供する。

```text
POST /v1/chat/completions
POST /v1/embeddings
GET  /health
GET  /models
```

Qwen の差異は `llm-gateway` で吸収する。

補足:

- `/v1/embeddings` は v2 の gateway 契約であり、Qwen3.5 を production embedding model に使うことを意味しない
- production embedding の方針は ADR-0008 で定義する

吸収対象:

- モデル名
- context length
- reasoning parser
- image input 有無
- system prompt 制約

## 7. コンテキスト別ルーティング

### 7.1 Intake Context

Qwen3.5 を使う。

- 意図分類
- 不足情報抽出
- 次質問候補生成

### 7.2 Repository Intelligence Context

Qwen3.5 を補助利用する。

- リポジトリ説明の要約
- 類似案件用の説明文正規化

ただし、Velocity Metric 自体はルール / 集計で出す。LLM には任せない。

### 7.3 Market Benchmark Context

Qwen3.5 は使わないか、下書き生成に限定する。

市場調査は 4 プロバイダ（Grok / Brave / Perplexity / Gemini）による外部検索と根拠リンクが前提のため、クラウド LLM を主とする。Evidence Aggregator によるクロスバリデーションもクラウド側で処理する。詳細は ADR-0002 を参照。

### 7.4 Estimation Context

Qwen3.5 は内部ドラフト生成に使う。

- 要件要約
- 実装論点整理
- 工数項目の叩き台

最終見積はルール / 実績 / クラウド検証で確定する。

### 7.5 Proposal & Approval Context

Qwen3.5 は内部要約のみ。

顧客提示の最終文面と市場根拠付き説明はクラウド LLM またはテンプレートで仕上げる。

### 7.6 Handoff Context

Qwen3.5 はタスク分解の草案生成に限定する。

最終的な Linear Issue 生成ルールはアプリ側で持つ。

### 7.7 Operational Intelligence Context

Qwen3.5 は使用しない。Operational Intelligence は BigQuery 上の構造化データに対する集計と分析で構成されるため、LLM ルーティングの対象外とする。

## 8. セキュリティ境界

ローカル LLM に寄せる目的は、コストだけではなく機密性である。

Qwen3.5 に優先的に流すデータ:

- 未公開の要件
- 顧客資料の全文
- 社内実績の詳細
- 顧客との会話ログ

これらの主経路は GKE 上の `llm-gateway + vLLM` に固定する。

クラウド LLM に送る前に、以下の段階を置く。

1. ローカル要約
2. 必要最小限の抜粋
3. 外部送信可否ルールの判定

## 9. 運用方針

### 9.1 モデル評価

最低限、以下を定点観測する。

- requirement 抽出の再現率
- intent 分類の正答率
- hallucination 率
- 平均応答時間
- token あたりコスト

### 9.2 フェイルオーバー

- `Qwen3.5-35B-A3B` 失敗時は `9B` に落とさない
- 精度が必要な処理はクラウド LLM に切り替える
- 軽量分類だけ `9B` にフォールバックする

## 10. 初期結論

`Qwen3.5` は BenevolentDirector v2 の「ローカル知能層」に十分採用候補になる。

ただし採用理由は「高性能だから」だけではない。v2 で重要なのは次の 3 点である。

- OpenAI 互換 API として隔離しやすい
- 小型から大型まで役割分担ができる
- multimodal 前提なので Deep Ingestion と相性がよい

## 11. 一次情報

- Qwen Team, `Qwen3.5` GitHub README
  - https://github.com/QwenLM/Qwen3.5

## 12. この文書での推論

以下は README そのものではなく、BenevolentDirector v2 への適用判断である。

- `9B` と `35B-A3B` の初期採用
- context ごとのモデル役割分担
- `vLLM` 優先の運用方針
- クラウド LLM とのハイブリッド構成
