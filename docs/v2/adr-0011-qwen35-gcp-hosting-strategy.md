# ADR-0011: Qwen3.5 の GCP ホスティングは GKE + vLLM を第一候補とする

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v2 では、顧客資料全文、会話ログ、社内 Git 実績といった Restricted データをローカル LLM 側で扱う前提になっている。

このため、Qwen3.5 のホスティング戦略は以下を同時に満たす必要がある。

- OpenAI 互換 API を `llm-gateway` の後ろで提供できる
- VPC 内に閉じた構成を選べる
- GCP 上で再現可能な運用基盤がある
- 9B から 35B-A3B まで段階的に拡張できる

一次情報として確認できる事項は以下。

- vLLM の Supported Models 文書では、`Qwen-3.5` を hybrid-only model として扱っている
- GKE には vLLM ベースの open model serving 向け reference architecture があり、`Qwen3 32-B` を単一ホスト GPU ノード上でサーブする公式ガイドがある
- Vertex AI Model Garden は self-deployed open models を Google Cloud project と VPC network 内にデプロイできる
- Cloud Run GPU は L4 または NVIDIA RTX PRO 6000 Blackwell GPU をサポートし、GPU サービスでも scale to zero が可能

## 決定

Qwen3.5 の GCP ホスティング優先順位を以下とする。

### 第一候補: GKE + vLLM

本番の第一候補は GKE 上の `llm-gateway (Python + vLLM)` とする。

用途:

- `Qwen3.5-9B`
  - 意図分類
  - 要約
  - 次質問候補生成
- `Qwen3.5-35B-A3B`
  - Requirement Artifact 初稿
  - ヒアリング下書き
  - Deep Ingestion 後の内部整理

位置づけ:

- Restricted データを扱う本命構成
- Terraform / Kubernetes manifest で再現可能な構成
- v2 の production default

### 第二候補: Vertex AI Model Garden self-deployed

Vertex AI Model Garden の self-deployed open model 機能は、評価環境または staging の候補とする。

用途:

- 迅速な比較検証
- 1-click に近いセルフデプロイ
- Endpoint と IAM の早期立ち上げ

制約:

- self-deployed models は serverless ではない
- Qwen family の model availability は model card に依存する
- Qwen3.5 が常に直接選べるとは限らない

したがって、本番標準にはしない。

### 第三候補: Cloud Run GPU

Cloud Run GPU は軽量な Qwen3.5 系サービスの補助候補とする。

用途:

- 開発 / 検証環境
- 低トラフィックの 9B 系 PoC
- scale to zero を重視する補助ワークロード

制約:

- 1 インスタンスあたり GPU は 1 枚
- 対応 GPU は L4 または RTX PRO 6000 Blackwell
- 35B-A3B の常用本番基盤としては前提が弱い

したがって、本番の主経路にはしない。

## 運用方針

### llm-gateway 経由を強制する

アプリケーションは常に `llm-gateway` の OpenAI 互換 API だけを呼ぶ。

```text
POST /v1/chat/completions
GET  /models
GET  /health
```

Qwen3.5 を直接叩くのは禁止する。

### ルーティング

1. Restricted データ（日本語会話・顧客資料）
   - GKE + vLLM 上の Qwen3.5 に送る
2. 軽量分類
   - `Qwen3.5-9B`（常駐、~5GB VRAM）
3. 高精度な内部生成
   - `Qwen3.5-35B-A3B`（オンデマンド、~20GB Q4）
4. Market Intelligence 検索結果の構造化
   - `GLM-4.7-Flash`（オンデマンド、~16GB Q4）
5. 外部検索や引用が必要
   - クラウド LLM を使う

### マルチモデル時分割運用

`Qwen3.5-35B-A3B` と `GLM-4.7-Flash` は同一 L4 GPU 上で時分割運用する。両モデルを同時にロードしない。

- `llm-gateway` がリクエストの `task_type` に基づき使用モデルを決定する
- モデル切り替え時はアイドル状態のモデルをアンロード → 新モデルをロード
- Market Intelligence は Pub/Sub 非同期タスクのため、切り替えレイテンシ（数十秒）は許容範囲
- 常駐する `Qwen3.5-9B` は別プロセスで軽量に動作し、切り替えの影響を受けない

GLM-4.7-Flash の選定根拠（ADR-0001 参照）:

- 30B-A3B MoE（アクティブ 3B）で Qwen と同一 GPU リソースで動作
- エージェントタスク（tau2-Bench: 79.5）、Web 検索結果の構造化（BrowseComp: 42.8）で優位
- MIT ライセンス
- vLLM サポート済み（main ブランチ）

### PoC 順序

1. `Qwen3.5-9B` を GKE + vLLM で PoC
2. `llm-gateway` にモデルルーティングを実装
3. Deep Ingestion と Intake を 9B で接続
4. `Qwen3.5-35B-A3B` は別途 benchmark 後に追加
5. `GLM-4.7-Flash` を Phase 4 Market Intelligence に合わせて追加（P2-04 でベンチマーク）

## 理由

### GKE の根拠

Google Cloud には vLLM を使って open models を GKE に載せる production-ready reference architecture がある。Qwen3 32-B を含む open model serving の公式ガイドもあり、構成の妥当性を説明しやすい。

### vLLM の根拠

vLLM 自体が Qwen-3.5 系を想定した文言を持ち、OpenAI-compatible server と Kubernetes / Helm / monitoring の周辺ドキュメントも揃っている。

### Vertex を第二候補に留める理由

Model Garden self-deployed は便利だが、model availability と運用の主導権が model card と Vertex の提供形態に依存する。本件では「完全に閉じた自前推論基盤」を優先するため、主経路には置かない。

### Cloud Run GPU を第三候補に留める理由

Cloud Run GPU は魅力的だが、1 GPU / instance であること、対応 GPU が限定されることから、v2 の主力である 35B-A3B の本番標準には置きにくい。一方で 9B の低負荷運用には相性がよい。

## 結果

### 良い結果

- Restricted データの主経路を GKE 内に固定できる
- `9B` から始めて `35B-A3B` へ段階的に拡張できる
- Vertex / Cloud Run を用途別の補助候補として使い分けられる

### 悪い結果

- GKE と vLLM の運用責任を自分たちで持つ必要がある
- Model Garden より初期構築は重い
- 35B-A3B の本番サイジングは別途 benchmark が必要

## 代替案

### 代替案 A: Vertex AI Model Garden を第一候補にする

却下理由:

- model availability の変動に依存する
- 本件では「完全閉域の自前経路」を主にしたい
- llm-gateway の背後に一貫した自前運用面を残したい

### 代替案 B: Cloud Run GPU を第一候補にする

却下理由:

- 35B-A3B の本番前提としては制約が強い
- 大きいモデルや長時間常駐の前提に対して設計余力が小さい

## 関連 ADR

- ADR-0001: ローカル LLM とクラウド LLM の境界
- ADR-0006: デプロイトポロジーとコスト最適化
- ADR-0008: embedding と生成モデルの責務分離
- ADR-0010: Restricted データの外部送信制御

## 一次情報

- vLLM Supported Models
  - https://docs.vllm.ai/en/latest/models/supported_models/
- Google Cloud, Serve open LLMs on GKE with a pre-configured architecture
  - https://cloud.google.com/kubernetes-engine/docs/tutorials/serve-open-models-terraform
- Google Cloud, Deploy open models from Model Garden
  - https://cloud.google.com/vertex-ai/generative-ai/docs/open-models/deploy-model-garden
- Google Cloud, GPU support for Cloud Run services
  - https://cloud.google.com/run/docs/configuring/services/gpu
- Z.ai, GLM-4.7-Flash Hugging Face Model Card
  - https://huggingface.co/zai-org/GLM-4.7-Flash
