# ADR-0001: ローカル LLM とクラウド LLM の境界を分離する

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v2 では、機密性の高いヒアリングと社内実績分析を扱う。一方で、市場調査や外部根拠付き説明には web 検索や外部知識が必要になる。

`Qwen3.5` の公式 README では、以下が確認できる。

- OpenAI 互換 API での利用例がある
- `transformers`、`SGLang`、`vLLM` でサービング可能
- multimodal と多言語を強化している
- Apache 2.0 ライセンス

このため、Grift v2 ではローカル推論を実務に組み込みやすい。

## 決定

ローカル LLM とクラウド LLM の責務を以下のように分離する。さらに、ローカル LLM は用途に応じて複数モデルを使い分ける。

### ローカル LLM モデル戦略

ローカル LLM は単一モデルに限定せず、用途特性に応じた最適モデルを `llm-gateway` のルーティングで選択する。

#### Qwen3.5 系（日本語品質 critical な用途）

- `Qwen3.5-9B`: 意図分類、要約、次質問候補生成、QA Pair 抽出
- `Qwen3.5-35B-A3B`: Requirement Artifact 初稿、ヒアリング下書き、Deep Ingestion 後の内部整理

選定理由: 201 言語対応。日本語の顧客入力を処理する用途では多言語品質が最優先。

#### GLM-4.7-Flash（エージェント・コーディング特化の用途）

- Market Intelligence の検索結果解析・構造化（BrowseComp: 42.8 vs Qwen 2.29）
- EvidenceFragment の構造化抽出
- コードベース分析の補助（SWE-bench Verified: 59.2）

選定理由: 30B-A3B MoE（アクティブ 3B）で Qwen と同一 GPU 上で時分割可能。MIT ライセンス。エージェント・Web 検索タスクで圧倒的優位（tau2-Bench: 79.5, BrowseComp: 42.8）。

#### GPU リソース共有方針

両モデルは同一 GKE L4 GPU ノード上で時分割運用する。同時ロードはしない。

- Qwen3.5-9B（~5GB VRAM）: 常駐。リアルタイム会話に使用
- Qwen3.5-35B-A3B（~20GB Q4）/ GLM-4.7-Flash（~16GB Q4）: オンデマンドロード。バッチ・非同期タスク向け
- Market Intelligence は Pub/Sub 経由の非同期タスクのため、モデル切り替えのレイテンシは許容可能

### ローカル LLM の用途

- 顧客ヒアリングの草案生成（Qwen3.5）
- 顧客資料の要約（Qwen3.5）
- Requirement Artifact の初稿（Qwen3.5）
- 社内向け分類、タグ付け、整理（Qwen3.5）
- Market Intelligence の検索結果構造化（GLM-4.7-Flash）

### クラウド LLM

- 市場相場の調査（Grok / Brave / Perplexity / Gemini の Web 検索）
- 引用付きの Market Evidence（外部 API 経由）
- 顧客提示の最終文章
- 外部知識を要する検証

### ハイブリッド

- 最終見積
- Go / No-Go
- bug / 追加判定

## 理由

### 機密性

会話ログ、要件、社内実績を外部 API に常時送らない構成にできる。

### コスト

頻度の高い内部処理をローカルに寄せることで API コストを制御しやすい。

### 実装の安定性

OpenAI 互換 API を `llm-gateway` で提供すれば、モデル変更の影響をアプリ本体に広げずに済む。

### 品質

市場調査のような外部根拠が必要な処理までローカル LLM に任せると、説得力が落ちる。

## 結果

### 良い結果

- コストと機密性の両立
- モデル置換が容易
- Bounded Context ごとの責務が明確

### 悪い結果

- 推論基盤の運用コストが増える
- ローカル / クラウドの評価基準を別々に持つ必要がある
- フォールバック設計が必要になる

## 代替案

### 代替案 A: 全処理をクラウド LLM に寄せる

却下理由:

- 機密性の要件に弱い
- API コストが増えやすい
- 将来の差別化要素である社内知識活用と相性が悪い

### 代替案 B: 全処理をローカル LLM に寄せる

却下理由:

- 市場調査と外部根拠収集の品質が不足する
- 顧客提示の説得力を担保しにくい

## 関連 ADR

- ADR-0002: クラウド LLM の具体的なプロバイダ構成（Grok / Brave / Perplexity / Gemini）を定義
- ADR-0003: データベースを Cloud SQL に移行し、マルチテナント（tenant_id）設計を導入
- ADR-0006: ローカル LLM の GPU デプロイ構成を定義

## 一次情報

- Qwen Team, `Qwen3.5` GitHub README
  - https://github.com/QwenLM/Qwen3.5
- Z.ai, `GLM-4.7-Flash` Hugging Face Model Card
  - https://huggingface.co/zai-org/GLM-4.7-Flash
- GLM-4.7-Flash Technical Report
  - https://arxiv.org/abs/2508.06471
