# ADR-0003: Supabase から Cloud SQL への移行

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v1 では Supabase を PostgreSQL データベースとして使用している。ただし、Supabase の差別化機能の大部分は使っていない。

v1 における Supabase 機能の利用状況:

| Supabase 機能 | v1 で使用 | 代替手段 |
|--------------|----------|---------|
| PostgreSQL | はい | Cloud SQL PostgreSQL |
| Auth | いいえ（Clerk 使用） | Firebase Auth |
| Realtime | いいえ（SSE 自前） | Pub/Sub |
| Edge Functions | いいえ | Cloud Run |
| Storage | 最小限 | GCS |
| RLS | 一部 | Cloud SQL native RLS + Go API RBAC |

v2 では以下が必要になる。

- BigQuery との密な連携（Datastream CDC）
- Pub/Sub によるイベント駆動
- GCS によるファイル保管
- GKE での Qwen3.5 GPU ワークロード
- マルチテナント対応
- Terraform による統一的なインフラ管理

## 決定

Cloud SQL (PostgreSQL) に移行する。v1 のデータは移行せず、v2 でクリーンスタートする。

### 移行しない理由

- v1 は MVP として構築したもので、既存顧客データはほぼ入っていない
- v2 ではスキーマが根本的に変わる（tenant_id 追加、Bounded Context 再編）
- データ移行のコストに対してリターンがない

### Cloud SQL 構成

```text
Cloud SQL PostgreSQL 15+
├─ pgvector 拡張（類似案件検索、Deep Ingestion）
├─ pg_cron（定期ジョブ、またはCloud Scheduler代替）
├─ 自動バックアップ（日次）
├─ リードレプリカ（将来のスケール時）
└─ Private IP（Cloud Run / GKE と同一 VPC）
```

### BigQuery 連携

```text
Cloud SQL
  ↓ Datastream (CDC: Change Data Capture)
BigQuery
  ↓ Scheduled Query
分析テーブル（見積精度、顧客ポートフォリオ、キャパシティ予測）
```

Datastream により、Cloud SQL の変更がリアルタイムで BigQuery に反映される。ETL パイプラインの自前実装が不要になる。

### ファイルストレージ

GCS に移行する。

- 顧客資料（PDF / ZIP / 画像）
- Source Analysis の中間成果物
- Requirement Artifact の添付ファイル
- Signed URL でアクセス制御

## 理由

### GCP 統合

全サービスが同一 IAM、同一 VPC、同一課金で管理できる。Supabase 経由では BigQuery 連携が外部連携扱いになり、認証とレイテンシが増える。

### Terraform 管理

Cloud SQL、BigQuery、GCS、Pub/Sub、Cloud Run、GKE を全て Terraform で宣言的に管理できる。Supabase のインフラは Terraform 管理の範囲外になる。

### マルチテナント

Cloud SQL では PostgreSQL native RLS を使えるため、アプリ層 RBAC と組み合わせて tenant_id 分離を強制できる。将来的にテナント単位のリードレプリカやデータベース分離への拡張も容易。

### コスト

Supabase Pro ($25/月) から Cloud SQL ($50-150/月) への増加はあるが、BigQuery Datastream との統合コスト削減や GCP コミットメント割引で相殺可能。

## 結果

### 良い結果

- GCP エコシステムとの統合がシームレスになる
- BigQuery へのデータ連携が Datastream で自動化される
- Terraform で全インフラを統一管理できる
- マルチテナント設計を自由に制御できる

### 悪い結果

- Supabase Dashboard のような管理 UI がなくなる（Cloud SQL Studio で代替）
- RLS policy とアプリ層 RBAC の両方を維持する必要がある
- 初期セットアップコストが Supabase より高い

## 代替案

### 代替案 A: Supabase を GCP 上でセルフホスト

却下理由:

- Supabase on GCP でも BigQuery 連携は自前実装が必要
- Pub/Sub や Cloud Run との統合も Supabase の管轄外
- 「GCP の中に Supabase という別世界がある」構成になり、運用が二重化する

### 代替案 B: Supabase Pro を継続

却下理由:

- v2 のコア要件（BigQuery CDC、Pub/Sub、GKE）との統合が外部連携になる
- SaaS 化時のマルチテナント制御が制限される
- Terraform 管理の範囲外が残る
