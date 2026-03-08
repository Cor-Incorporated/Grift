# ADR-0006: デプロイトポロジーとコスト最適化

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v2 は Go API、Python Worker、Qwen3.5 llm-gateway、React Web の 4 コンポーネントで構成される。GPU ワークロード（Qwen3.5）と通常ワークロードが混在するため、デプロイ基盤の選択が重要になる。

当面の運用は日本市場に限定する。

## 決定

Cloud Run + GKE 混在構成を採用し、Terraform で管理する。Qwen3.5 の本番主経路は GKE + vLLM とし、Vertex AI Model Garden self-deployed と Cloud Run GPU は補助候補として扱う。

### デプロイ構成

```text
Cloud Run（サーバーレス）
├─ control-api (Go)
│   ├─ CPU: 1-2 vCPU
│   ├─ Memory: 512MB-1GB
│   ├─ Min instances: 0（深夜はゼロスケール）
│   ├─ Max instances: 10
│   └─ Concurrency: 80
│
├─ intelligence-worker (Python)
│   ├─ Pub/Sub トリガー（イベント駆動）
│   ├─ CPU: 2-4 vCPU
│   ├─ Memory: 2-4GB
│   ├─ Timeout: 300s（Deep Ingestion 用）
│   └─ Max instances: 5
│
└─ web (React)
    ├─ Cloud Run or Cloud CDN + GCS（静的ホスティング）
    └─ 静的エクスポートの場合は GCS + Cloud CDN が最安

GKE Autopilot（GPU ワークロード）
└─ llm-gateway (Python + vLLM)
    ├─ Qwen3.5-9B: NVIDIA L4 × 1 または A10G × 1（24GB VRAM で十分）
    ├─ Qwen3.5-35B-A3B: 暫定見積は A10G × 1（量子化前提）または A100 × 1（非量子化）
    ├─ 初期は 9B のみデプロイし、35B-A3B は評価完了後に追加
    ├─ Node: g2-standard-4 or g2-standard-8
    ├─ Replicas: 1（初期）
    └─ HPA: GPU utilization ベース

Vertex AI Model Garden（補助候補）
└─ self-deployed open models
    ├─ 検証 / staging 用
    └─ model availability は model card 依存

Cloud Run GPU（補助候補）
└─ 9B 系の軽量 PoC
    ├─ L4 または RTX PRO 6000 Blackwell
    ├─ 1 GPU / instance
    └─ scale to zero 可能
```

GPU サイジングの補足:

- `Qwen3.5-9B` は 24GB VRAM（L4 / A10G）で FP16 動作可能
- `Qwen3.5-35B-A3B` の本番サイジングは benchmark 前提とする
- 暫定的には、MoE と量子化を前提に A10G 1 枚相当から評価を開始し、必要なら A100 系へ引き上げる
- 初期フェーズでは `9B` のみを常時稼働させ、`35B-A3B` は評価完了後に追加する

### コスト最適化：夜間停止

日本限定運用のため、JST 1:00-8:00（UTC 16:00-23:00）は GPU ノードを停止する。

```text
Terraform + Cloud Scheduler
├─ JST 1:00: GKE node pool → 0 ノード
├─ JST 8:00: GKE node pool → 1 ノード
├─ Cloud Run: 自動ゼロスケール（追加設定不要）
└─ Cloud SQL: 常時稼働（停止非推奨）
```

### 月額コスト概算（日本リージョン、夜間停止あり）

以下の GPU コストは暫定的な設計見積であり、Phase 2 の benchmark 後に更新する。

| 項目 | 常時稼働 | 夜間停止 (17h/日) | 備考 |
|------|---------|-------------------|------|
| Cloud SQL (db-custom-2-8192) | $120 | $120 | 停止非推奨、常時稼働 |
| Cloud Run (API + Worker) | $80 | $50 | 深夜リクエストなし前提 |
| GKE GPU (A10G × 1) | $550 | **$390** | 17h/24h = 71% 稼働 |
| GKE GPU (L4 × 1) | $350 | **$250** | コスト優先の代替 |
| BigQuery | $20 | $20 | 1TB 未満 |
| Pub/Sub | $10 | $10 | |
| GCS | $5 | $5 | |
| Cloud CDN | $10 | $10 | |
| 外部 API (Grok/Brave/Perplexity/Gemini) | $150 | $150 | 利用量次第 |
| Firebase Auth | $0 | $0 | 50K MAU 未満は無料 |
| **合計 (A10G)** | **$945** | **$755** | |
| **合計 (L4)** | **$745** | **$615** | |

v1（Vercel + Supabase）の $50-100/月 からは増加するが、GPU ワークロードを含む構成としては合理的な範囲。

### Terraform 構成

```text
infra/terraform/
├─ main.tf
├─ variables.tf
├─ outputs.tf
├─ modules/
│   ├─ network/          # VPC, Subnets, NAT
│   ├─ cloudsql/         # Cloud SQL + pgvector
│   ├─ cloudrun/         # control-api, intelligence-worker, web
│   ├─ gke/              # GKE Autopilot + GPU node pool
│   ├─ bigquery/         # Dataset, tables, Datastream
│   ├─ pubsub/           # Topics, subscriptions
│   ├─ scheduler/        # Cloud Scheduler (夜間停止)
│   ├─ storage/          # GCS buckets
│   ├─ iam/              # Service accounts, roles
│   └─ monitoring/       # Alerting, dashboards
├─ environments/
│   ├─ dev/
│   ├─ staging/
│   └─ production/
└─ backend.tf            # GCS state backend
```

### スケーリング戦略

初期（〜10 テナント）:

- Cloud Run: デフォルトオートスケール
- GKE: A10G × 1、手動スケール
- Cloud SQL: db-custom-2-8192

成長期（10-50 テナント）:

- Cloud Run: max instances 引き上げ
- GKE: A10G × 2（HPA）
- Cloud SQL: db-custom-4-16384 + リードレプリカ

拡大期（50+ テナント）:

- GKE: 専用 GPU node pool × テナントグループ
- Cloud SQL: テナントグループ別データベース分離を検討
- BigQuery: テナント別パーティション最適化

## 理由

### Cloud Run + GKE 混在

GPU ワークロード（llm-gateway）は Cloud Run では対応しにくい（GPU 対応は限定的）。一方、API と Worker を GKE に入れるのはオーバーキル。適材適所の構成にする。

### GKE + vLLM を主経路にする理由

Google Cloud には、vLLM を前提とした open model serving の reference architecture と、Qwen3 32-B を含む GKE serving ガイドがある。Qwen3.5 そのものの個別ガイドではないが、運用パターンとしては最も近い一次情報である。

### Vertex / Cloud Run を補助候補にする理由

Vertex AI Model Garden self-deployed は project / VPC 内に安全に載せられるが、本件では model availability と運用主導権の観点から主経路にはしない。Cloud Run GPU は scale to zero が強いが、主力モデルの本番経路としては制約が強い。

### Terraform 管理

全インフラをコードで管理することで、環境の再現性、レビュー可能性、ロールバックが担保される。

### 夜間停止

日本市場限定のため、深夜の GPU コストを削減しても業務に影響しない。月額 $160-200 の節約になる。

## 結果

### 良い結果

- GPU コストを 29% 削減できる
- Cloud Run のゼロスケールで深夜の API コストもほぼゼロ
- Terraform で環境の複製が容易（dev / staging / production）
- GKE Autopilot でノード管理の運用負荷を軽減

### 悪い結果

- Cloud Run と GKE の 2 系統のデプロイパイプラインが必要
- GKE の GPU ノード起動に 2-5 分かかる（JST 8:00 の起動遅延）
- Terraform の学習コストと初期構築コスト

## 代替案

### 代替案 A: 全部 Cloud Run

却下理由:

- GPU ワークロードの対応が限定的
- llm-gateway のような常駐型サービスには Cloud Run のコールドスタートが不向き

### 代替案 B: 全部 GKE

却下理由:

- API と Worker を GKE で管理するのはオーバーキル
- Cloud Run のゼロスケールの方がコスト効率が高い
- 運用負荷が不必要に高くなる

### 代替案 C: 外部 LLM API のみ（GPU 不要）

却下理由:

- ローカル LLM による機密性とコスト最適化のメリットを放棄することになる
- ADR-0001 で決定済みの方針と矛盾する

## 関連 ADR

- ADR-0001: ローカル LLM とクラウド LLM の境界
- ADR-0011: Qwen3.5 の GCP ホスティング優先順位
