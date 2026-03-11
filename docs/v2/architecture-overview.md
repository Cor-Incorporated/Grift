# Grift v2 アーキテクチャ概要

最終更新: 2026-03-08

## 1. 目的

Grift v2 は、受託開発会社における上流工程の不確実性を下げるための業務基盤として再設計する。

対象業務は以下に限定する。

- 新規顧客の初期ヒアリング
- 既存顧客の追加開発 / 改修 / バグ報告の整理
- 要件定義書、見積、提案、承認、Linear handoff の一気通貫

将来的には SaaS として他の受託開発会社にも展開する。

## 2. v1 からの構造的な変更

v1 は Next.js 単一アプリの中で、会話、解析、見積、承認、外部連携が近接している。

v2 では、以下の 4 プレーンに分離する。

```text
Experience Plane
  - React Web
  - 将来の Slack App / Mobile App

Control Plane
  - Go API
  - 認証、Case 管理、承認、Handoff、Webhook、外部連携

Intelligence Plane
  - Python Worker
  - Qwen3.5 推論、Deep Ingestion、Embedding、RAG、Market Benchmark

Data Plane
  - Cloud SQL (PostgreSQL + pgvector)
  - GCS
  - Pub/Sub
  - BigQuery
```

## 3. システム構成

### 3.1 リポジトリ構成

```text
apps/
  web/                      # React (Vite or Next.js static export)
services/
  control-api/             # Go
  intelligence-worker/     # Python
  llm-gateway/             # Python + vLLM or SGLang
packages/
  contracts/               # OpenAPI spec + Pub/Sub message schema
  domain-core/             # Ubiquitous Language + shared types
infra/
  terraform/               # GCP infrastructure
  docker/                  # docker-compose for local dev
docs/
  v2/
```

### 3.2 主要コンポーネント

- `web`
  - 案件一覧、ヒアリング UI、提案 UI、管理 UI
  - OpenAPI spec から自動生成された API クライアントを使用
- `control-api`
  - Case API
  - Approval API
  - Handoff API
  - GitHub App / Linear / Slack の ACL
  - Firebase Auth JWT 検証ミドルウェア
  - テナント分離ミドルウェア
- `intelligence-worker`
  - 資料 ingestion
  - Requirement Artifact 生成
  - Market Evidence 生成（マルチプロバイダ）
  - Estimate 算出
- `llm-gateway`
  - Qwen3.5 の OpenAI 互換エンドポイント
  - モデルルーティング
  - ローカル推論の監視

## 4. API 契約

### 4.1 React ↔ Go API

REST (OpenAPI 3.1) を採用する。

- `packages/contracts/openapi.yaml` に spec を一元管理
- openapi-generator で React 側の型安全なクライアントを自動生成
- Go 側は oapi-codegen でハンドラインターフェースを生成

選定理由:

- チーム内での理解コストが最も低い
- ツールチェーンが最も成熟している
- SaaS 化時に外部開発者向け API ドキュメントとしてそのまま公開できる

### 4.2 Go → Python Worker

Pub/Sub メッセージを使った非同期通信を採用する。

- メッセージスキーマは `packages/contracts/events/` に JSON Schema で定義
- 同期的な LLM 呼び出しが必要な場合は llm-gateway の OpenAI 互換 REST を直接呼ぶ

### 4.3 Go → 外部 SaaS

各 SDK を ACL (Anti-Corruption Layer) で包む。

- Linear SDK
- GitHub App (Octokit)
- Slack API
- Firebase Admin SDK

## 5. 認証とセキュリティ

### 5.1 認証

Firebase Auth / Google Identity Platform を採用する。

- SaaS 化時のマルチテナント対応が容易
- GCP サービス間認証と統一された IAM
- v1 の Clerk からの移行コストは低い（v1 にはほぼユーザーがいない）

認証フロー:

```text
React → Firebase Auth SDK → ID Token 取得
  → Go API (JWT 検証ミドルウェア) → tenant_id 抽出 → リクエスト処理
```

### 5.2 RBAC

Go API ミドルウェアで実装する。

- JWT からユーザー情報と tenant_id を抽出
- ロール: `owner`, `admin`, `manager`, `member`, `viewer`
- RBAC はアプリ層で判定する
- tenant 境界は Cloud SQL native RLS でも強制する
- リポジトリ層でも `tenant_id` を明示し、二重ガードにする

### 5.3 マルチテナント

初期から tenant_id を全テーブルに設計する。

- `tenants` テーブルで組織管理
- 全ドメインテーブルに `tenant_id` カラム + インデックス
- Cloud SQL native RLS を有効化し、`FORCE ROW LEVEL SECURITY` を原則とする
- Go ミドルウェアで tenant context を注入する
- BigQuery も `tenant_id` を必須列とし、authorized views または row access policies で制御する

## 6. Bounded Context

v2 は以下の 7 つの Bounded Context で構成する。

1. Intake Context
2. Repository Intelligence Context
3. Market Benchmark Context
4. Estimation Context
5. Proposal & Approval Context
6. Handoff Context
7. Operational Intelligence Context

### 6.1 Intake Context

責務:

- ヒアリング開始
- 顧客メッセージの意図分解
- URL / PDF / ZIP の受付
- 資料取り込みジョブの起動

主な成果物:

- `Case`
- `ConversationTurn`
- `SourceDocument`

### 6.2 Repository Intelligence Context

責務:

- GitHub App Installation Token によるリポジトリ発見
- 個人 / Organization 横断の定期クロール
- Velocity Metric の正規化
- 類似案件の比較素材生成

主な成果物:

- `RepositorySnapshot`
- `VelocityMetric`
- `SimilarityFeature`

### 6.3 Market Benchmark Context

責務:

- Market Intelligence Orchestrator による 4 プロバイダ（Grok / Brave / Perplexity / Gemini）への並列リクエスト
- Evidence Aggregator（Domain Service）によるクロスバリデーション
- 根拠リンク付き `MarketEvidence` の生成
- 信頼度スコアリング（合意度ベース）

主なコンポーネント:

- `Market Intelligence Orchestrator` — Python Worker 内で 4 プロバイダに並列リクエストを発行
- `Evidence Aggregator` — Domain Service。プロバイダ横断のクロスバリデーションと信頼度判定を担う

主な成果物:

- `EvidenceFragment` (プロバイダ別の生データ、Value Object)
- `AggregatedEvidence` (クロスバリデーション済み、Value Object)
- `MarketEvidence` (最終成果物)
- `EvidenceCitation`

詳細は ADR-0002 を参照。

### 6.4 Estimation Context

責務:

- Requirement Artifact と Velocity と Market Evidence を統合
- Three-Way Proposal を生成
- 価格差と競争優位の説明を生成

Three-Way Proposal の 3 軸:

| 軸 | 内容 | データソース |
|---|---|---|
| 自社実績 | 類似案件の実工数と Velocity | Repository Intelligence + pgvector 類似検索 |
| 市場相場 | 複数ソース検証済みの工数と単価帯 | Market Benchmark (AggregatedEvidence) |
| 当社提案 | 実績ベース工数 × 自社単価 + 競争優位説明 | 上記 2 軸の統合 + BigQuery 実績補正 |

BigQuery からのフィードバック:

- 同規模案件の実績中央値による補正
- 顧客固有の工数倍率（過去案件の見積 vs 実績比）
- 技術スタック別の傾向係数

主な成果物:

- `RequirementArtifact`
- `Estimate`
- `ThreeWayProposal`

### 6.5 Proposal & Approval Context

責務:

- 顧客提示
- 合意履歴
- Go / No-Go 判定
- 承認フロー

主な成果物:

- `ProposalSession`
- `ApprovalDecision`

### 6.6 Handoff Context

責務:

- 合意済み要件から Linear Project / Issue を生成
- GitHub Issues への技術タスク展開
- 将来の Slack 通知や運用フローへ橋渡し
- 要件確定後の bug / additional scope 判定

主な成果物:

- `HandoffPackage`
- `LinearSyncResult`
- `GitHubIssueSyncResult`
- `ChangeClassification`

### 6.7 Operational Intelligence Context

責務:

- 実行データ収集（GitHub / Linear / Slack / Discord）
- BigQuery への蓄積と分析
- 見積精度キャリブレーション
- 顧客ポートフォリオ分析
- チームキャパシティ予測
- フィードバック生成（Estimation / Go-No-Go / Market Benchmark への補正値）
- 経営判断支援（顧客継続 / 終了推奨、新規受注可否、価格改定根拠）
- `analytics_opt_in` tenant から匿名化済み cross-tenant benchmark を生成
- 将来の model eval / training 向け候補 cohort を整備する

主な成果物:

- `ProjectOutcome`
- `CustomerPortfolioReport`
- `AccuracyCalibration`
- `CapacityForecast`
- `PricingRecommendation`
- `CrossTenantBenchmark`
- `DemandTrendReport`
- `StrengthPatternReport`

詳細は ADR-0004 を参照。

## 7. タスク管理の責務分割

### 7.1 Linear（ビジネスレイヤー SSOT）

- 案件単位の Project
- フェーズ単位の Cycle
- ビジネス要件レベルの Issue
- Slack / Discord 通知連携
- 顧客、営業、PM が見る場所

### 7.2 GitHub Issues & Projects（技術レイヤー SSOT）

- 実装タスク（PR 紐付き）
- バグトラッキング
- コードレビュー連携
- CI/CD ステータス
- エンジニアが動く場所

### 7.3 同期方向

Linear → GitHub の一方向参照を基本とする。

- Linear Issue に GitHub Issue / PR リンクを貼る
- GitHub 側の完了 → Webhook → Linear 側のステータス更新
- ビジネス判断は Linear、実装事実は GitHub が SSOT

詳細は ADR-0005 を参照。

## 8. Qwen3.5 の位置づけ

`Qwen3.5` は v2 のローカル LLM 基盤として使うが、コアドメインそのものではない。`llm-gateway` 配下の推論サービスとして隔離する。

Qwen3.5 の一次情報から確認できる重要な点は以下。

- 2026-02-16 に最初の Qwen3.5 を公開
- 2026-02-24 に `Qwen3.5-122B-A10B`、`Qwen3.5-35B-A3B`、`Qwen3.5-27B` を公開
- 2026-03-02 に `Qwen3.5-9B`、`4B`、`2B`、`0.8B` を公開
- 201 言語 / 方言対応を明示
- text と vision を含む multimodal を強調
- `transformers`、`llama.cpp`、`mlx`、`SGLang`、`vLLM` での利用例がある
- OpenAI 互換 API での提供例がある
- Apache 2.0 ライセンス

詳細は `qwen35-local-llm-strategy.md` を参照。

ホスティング優先順位は以下とする。

- 第一候補: GKE + vLLM
- 第二候補: Vertex AI Model Garden self-deployed
- 第三候補: Cloud Run GPU（軽量系補助）

詳細は ADR-0011 を参照。

## 9. ローカル LLM とクラウド LLM の役割分担

### 9.1 ローカル LLM に寄せる処理

- 顧客ヒアリングの下書き生成
- 意図分類
- Requirement Artifact の草案生成
- 顧客資料の要約とタグ付け
- 内部向けの差分要約
- 社内専用メモ生成

### 9.2 クラウド LLM に残す処理

- web 検索が必要な市場調査（Grok / Perplexity / Gemini）
- 根拠リンクが必須の `MarketEvidence`
- 顧客向けの最終提案文面
- 外部根拠の再照合

### 9.3 ハイブリッドにする処理

- Go / No-Go
- 最終見積
- bug / 追加開発判定

ここはローカル生成の一次案を基に、クラウド LLM またはルールエンジンで再検証する。

## 10. データ構造

### 10.1 OLTP

`Cloud SQL (PostgreSQL)` をシステムの SSOT とする。

全テーブルに `tenant_id` を持たせ、Cloud SQL native RLS とアプリ層の二重ガードで分離を強制する。

格納対象:

- Tenant
- Case
- ConversationTurn
- RequirementArtifact
- Estimate
- ApprovalDecision
- HandoffPackage

### 10.2 Retrieval

`pgvector` を `RequirementArtifact` と `SourceDocumentChunk` に適用する。

格納対象:

- PDF / URL / ZIP 展開結果
- 顧客ヒアリングの要約単位
- 類似案件検索用の説明ベクトル

### 10.3 Analytics

`BigQuery` にはイベントログ、実績データ、評価データを流す。

まず `tenant-scoped analytics` を保持し、その上に匿名化済み `cross-tenant analytics` を別レイヤーで構築する。

tenant-scoped レイヤー:

- `tenant_id` を必須とする
- authorized views / row access policies で分離する
- 見積補正、顧客分析、キャパシティ予測に使う

cross-tenant レイヤー:

- `analytics_opt_in` tenant のみ対象
- direct identifier を持たない
- cohort しきい値を満たす集計だけを保持する
- customer-facing benchmark と内部 pricing index に使う

格納対象:

- Case 開始から合意までの所要時間
- 見積 vs 実績工数の差分
- 顧客ポートフォリオメトリクス（LTV、バグ率、追加開発率）
- Qwen3.5 とクラウド LLM の比較結果
- 提案受注率
- bug / 追加判定の事後正答率
- プロバイダ別市場エビデンスの品質スコア

cross-tenant 派生例:

- 月次 pricing index
- 匿名 cohort benchmark
- 技術スタック採用トレンド
- capability と win rate の相関

`BigQuery` は学習 corpus の本体ストアではない。学習候補の抽出、label 集計、lineage、eval set 生成に使い、実際の corpus snapshot は `GCS` に置く。

詳細は ADR-0012、ADR-0013 を参照。

### 10.4 Training Corpus

上流工程特化モデル向けの学習データは、analytics とは別レイヤーで管理する。

前提:

- `training_opt_in = true` が必要
- redaction / normalization を通したデータだけを対象にする
- dataset version と deletion tombstone を持つ

格納対象:

- instruction tuning 用 JSONL
- classification / reranker 用 Parquet
- eval set snapshot

保管先:

- `GCS`: corpus snapshot
- `BigQuery`: cohort / lineage / eval metadata
- `Cloud SQL`: opt-in 状態と publish 履歴

## 11. イベント駆動

Pub/Sub で以下のドメインイベントを流す。

- `CaseOpened`
- `ConversationTurnCaptured`
- `SourceDocumentIngested`
- `RequirementArtifactDrafted`
- `VelocityMetricRefreshed`
- `MarketEvidenceCollected`
- `MarketEvidenceAggregated`
- `EstimateGenerated`
- `ProposalApproved`
- `HandoffRequested`
- `HandoffCompleted`
- `ProjectOutcomeRecorded`
- `CalibrationUpdated`
- `CapacityForecastRefreshed`
- `CustomerHealthChanged`
- `CrossTenantBenchmarkRefreshed`
- `TrainingCorpusPublished`

## 12. デプロイトポロジー

Cloud Run + GKE 混在構成を採用する。Terraform で管理する。

```text
Cloud Run
├─ control-api (Go)         # オートスケール、リクエスト駆動
├─ intelligence-worker (Python) # Pub/Sub トリガー or Cloud Run Jobs
└─ web (静的ホスティング or Cloud Run)

GKE (GPU node pool)
└─ llm-gateway (Python + vLLM) # Qwen3.5 の本番主経路

Vertex AI Model Garden (self-deployed)
└─ 評価 / staging の補助候補

Cloud Run GPU
└─ 9B 系の軽量 PoC / 低トラフィック補助候補
```

コスト最適化:

- 日本限定運用のため、JST 1:00-8:00 は GKE GPU ノードをスケールダウン
- Cloud Run は自動スケールで深夜はゼロインスタンス
- Terraform scheduled scaling で管理

詳細は ADR-0006 と ADR-0011 を参照。

## 13. 実装原則

- フロントは API 契約だけを見る
- Go は同期 API と業務整合性を担う
- Python は非同期ジョブと LLM / RAG を担う
- Qwen3.5 は `llm-gateway` の後ろに置き、直接アプリから呼ばない
- 外部 SaaS は ACL で包む
- 全テーブルに tenant_id を持たせる
- v2 はモジュラーモノリスとして開始し、境界が固まったものだけ独立デプロイ可能にする
- ローカル開発は Docker + mise で統一する

## 14. 一次情報

- Qwen Team, `Qwen3.5` GitHub README
  - https://github.com/QwenLM/Qwen3.5

## 15. この文書での推論

以下は Qwen3.5 README の直接記述ではなく、本プロダクトへの適用方針としての設計判断である。

- `Go + Python + React` の分離構成
- `llm-gateway` の導入
- ローカル / クラウドの役割分担
- Cloud SQL / pgvector / BigQuery / Pub/Sub の責務分割
- tenant 内 analytics と cross-tenant anonymous intelligence の分離
- analytics opt-in と training opt-in の分離
- Firebase Auth / Identity Platform の採用
- マルチテナント設計
- Cloud Run + GKE 混在デプロイ
- OpenAPI + Pub/Sub の API 契約
- マルチプロバイダ市場調査
- Linear / GitHub Issues の責務分割
- Operational Intelligence Context の追加
