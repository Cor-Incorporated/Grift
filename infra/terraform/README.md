# infra/terraform

v2 の GCP 基盤を Terraform で管理する。

対象:

- VPC
- Cloud SQL
- GCS
- Pub/Sub
- BigQuery
- Cloud Run
- GKE
- Secret Manager

環境ごとの差分は `environments/dev`, `staging`, `prod` に切る前提で構築する。
