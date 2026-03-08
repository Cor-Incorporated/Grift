# BenevolentDirector v2 実装ロードマップ

最終更新: 2026-03-08

## 1. 前提

このロードマップは以下を前提にする。

- フロントは React 単独アプリへ分離する
- 同期 API は Go、非同期知能処理は Python へ分離する
- ローカル LLM 基盤は `Qwen3.5`
- Qwen3.5 の一次情報は GitHub README を基準にする
- データベースは Cloud SQL (PostgreSQL + pgvector)
- 分析基盤は BigQuery
- 認証は Firebase Auth / Google Identity Platform
- デプロイは Cloud Run + GKE (Terraform 管理)
- v1 のデータは移行しない（クリーンスタート）
- ローカル開発環境は Docker + mise で統一する
- 初期からマルチテナント設計（SaaS 化前提）

## 2. Phase 0: 境界固定 + 開発環境

期間目安: 1-2 週間

成果物:

- monorepo 雛形（apps / services / packages / infra / docs）
- `web` / `control-api` / `intelligence-worker` / `llm-gateway` の最小骨格
- GCP / Firebase / GitHub App / Linear の bootstrap 手順書
- `Case` `RequirementArtifact` `Estimate` `Tenant` の共通 schema
- `packages/contracts/openapi.yaml` の初版
- Pub/Sub イベント一覧とメッセージスキーマ
- Docker Compose（PostgreSQL + pgvector, Pub/Sub emulator, Redis）
- mise タスク定義（dev, test, lint, build, migrate）
- Terraform 基盤（VPC, Cloud SQL, GCS, Pub/Sub）
- Firebase Auth プロジェクト設定
- CI/CD パイプライン（GitHub Actions）
- `.env.local` を repo root に保持したまま v2 へ移行する運用ルール

完了条件:

- `mise run dev` で全コンポーネントがローカル起動する
- API 契約が固定される
- v1 の `intake` `estimates` `approval` `linear` の責務が v2 context に再配置される
- テナント分離がミドルウェアレベルで機能する
- bootstrap 必須項目が `platform-bootstrap.md` と `ci:v2:env` で検証できる

## 3. Phase 1: Repository Intelligence Context

Repository Intelligence は Intake パイプラインへの依存がなく、独立して構築できる。先に着手することで Phase 4（Market Benchmark + Estimation）までに Velocity データの蓄積期間を確保する。

期間目安: 1 週間

成果物:

- GitHub App Installation Token 連携
- 個人 / Organization 横断の repository discovery
- 定期クロールジョブ（Cloud Scheduler + Cloud Run Jobs）
- Velocity Metric の正規化
- BigQuery への Velocity 時系列蓄積

完了条件:

- Org 配下も含めたリポジトリ収集が動く
- `VelocityMetricRefreshed` イベントが出る
- BigQuery に Velocity データが蓄積される

## 4. Phase 2: Qwen3.5 基盤

期間目安: 1 週間

成果物:

- `llm-gateway` の OpenAI 互換 API
- 開発環境での `mlx-lm` / `llama.cpp` 起動手順
- GKE + vLLM による `Qwen3.5-9B` PoC
- ステージングでの `vLLM` 起動手順（GKE A10G）
- Cloud Run GPU の軽量検証手順（任意）
- `Qwen3.5-9B` と `Qwen3.5-35B-A3B` の比較表
- Terraform: GKE GPU node pool + Cloud Scheduler（夜間停止）
- PoC 合格基準文書と benchmark 記録テンプレート

完了条件:

- API からモデル名を指定して推論できる
- intent 分類と要約がローカル LLM 経由で動く
- 9B PoC が GKE 上で安定動作する
- 夜間停止が自動で動作する
- `qwen35-poc-acceptance-criteria.md` の合格条件をすべて満たす

## 5. Phase 3: Deep Ingestion + Intake

期間目安: 2 週間

成果物:

- SourceDocument 保存（GCS）
- chunking + embedding（専用 EmbeddingProvider、ADR-0008）
- pgvector 検索
- Requirement Artifact への引用反映
- ヒアリング UI（React）
- 意図分類 + 不足情報抽出（Qwen3.5）
- SSE ストリーミング

完了条件:

- URL / PDF / ZIP を取り込み、会話中に RAG で再利用できる
- 資料由来の根拠を内部表示できる
- ヒアリングから仕様書生成まで一気通貫で動く

## 6. Phase 4: Market Benchmark + Estimation

期間目安: 2 週間

成果物:

- Market Intelligence Orchestrator（4 プロバイダ並列）
- Evidence Aggregator（クロスバリデーション）
- EvidenceFragment / AggregatedEvidence の実装
- Three-Way Proposal 生成
- BigQuery からの実績補正取得
- 見積 UI（React）

完了条件:

- 自社実績、市場根拠、当社提案の 3 軸が同一画面で比較できる
- 3 ソース以上の合意で confidence: high が出る
- 矛盾検出時に人間レビューフラグが立つ

## 7. Phase 5: Approval + Handoff

期間目安: 1-2 週間

成果物:

- Go / No-Go の新ルール（BigQuery 補正値込み）
- 承認ログ
- Linear handoff（Project → Cycle → Issue）
- GitHub Issues / Projects handoff（技術タスク分解）
- Linear ↔ GitHub 同期 Webhook
- webhook receipt / idempotency key / replay 導入（ADR-0009）
- bug / 追加開発判定（RequirementArtifact ベース）

完了条件:

- 合意済み要件から Linear Issue と GitHub Issue を同時生成できる
- GitHub Issue close → Linear ステータス更新が動く
- 変更要求に対して bug / additional scope を判定できる

## 8. Phase 6: Operational Intelligence

期間目安: 2 週間

成果物:

- BigQuery Datastream 設定（Cloud SQL CDC）
- GitHub / Linear / Slack イベント収集パイプライン
- 見積精度キャリブレーション
- 顧客ポートフォリオ分析ダッシュボード
- Estimation Context へのフィードバック API
- プロバイダ別エビデンス品質トラッキング

完了条件:

- 案件完了時に見積 vs 実績が BigQuery に記録される
- 次回見積時に過去実績からの補正値が反映される
- 顧客ポートフォリオレポートが生成できる

## 9. 最小検証セット

各 phase で最低限通すべき検証:

- `lint`
- `type-check`（Go: go vet, Python: mypy, React: tsc）
- unit tests
- API contract tests（OpenAPI spec との整合）
- 代表ユースケースの e2e
- tenant isolation tests
- webhook duplicate / replay tests

詳細は `testing-strategy.md` を参照。

Qwen3.5 導入後に必須の評価:

- intent 分類正答率
- requirement 抽出正答率
- 要約の引用整合性
- 応答レイテンシ
- ローカル / クラウド比較

Market Benchmark 導入後に必須の評価:

- プロバイダ別の citation 数
- クロスバリデーションの合意率
- 見積採用後の実績との乖離率

## 10. コスト概算

### 開発期間中（dev / staging）

| 項目 | 月額 |
|------|------|
| Cloud SQL (dev) | $30 |
| GKE GPU (L4, staging のみ) | $100 |
| BigQuery | $5 |
| 外部 API | $50 |
| **合計** | **$185** |

### 本番運用（夜間停止あり）

| 項目 | 月額 |
|------|------|
| Cloud SQL | $120 |
| Cloud Run | $50 |
| GKE GPU (L4, 夜間停止) | $250 |
| BigQuery | $20 |
| Pub/Sub + GCS + CDN | $25 |
| 外部 API | $150 |
| **合計** | **$615** |

上記は L4 GPU 構成の概算。A10G 構成の場合は $755/月。詳細は ADR-0006 を参照。

## 11. 先にやらないこと

- fine-tuning
- 巨大モデル常時運用（122B 以上）
- いきなりの microservices 化
- BigQuery をオンライン RAG の主ストアにすること
- マルチリージョンデプロイ
- モバイルアプリ

これらは v2 の初期成功条件ではない。

## 12. 一次情報

- Qwen Team, `Qwen3.5` GitHub README
  - https://github.com/QwenLM/Qwen3.5
