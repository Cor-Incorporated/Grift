# -----------------------------------------------------
# BigQuery Dataset for Velocity Analytics
# -----------------------------------------------------
resource "google_bigquery_dataset" "velocity" {
  project    = var.project_id
  dataset_id = "bd_${var.environment}_${var.dataset_id}"
  location   = var.region

  friendly_name = "Velocity Analytics (${var.environment})"
  description   = "Stores velocity metrics history for repository performance analysis"

  default_table_expiration_ms = var.expiration_days * 24 * 60 * 60 * 1000

  delete_contents_on_destroy = var.delete_contents_on_destroy

  labels = local.labels
}

# -----------------------------------------------------
# Velocity Metrics History Table
# -----------------------------------------------------
resource "google_bigquery_table" "velocity_metrics_history" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.velocity.dataset_id
  table_id   = var.table_id

  friendly_name = "Velocity Metrics History"
  description   = "Time-series velocity metrics per repository, partitioned by measurement date"

  deletion_protection = false

  time_partitioning {
    type  = "DAY"
    field = "measured_at"
  }

  clustering = ["tenant_id", "repository_id"]

  schema = jsonencode([
    {
      name        = "tenant_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Tenant identifier for multi-tenancy isolation"
    },
    {
      name        = "repository_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Unique repository identifier"
    },
    {
      name        = "measured_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp when the velocity metrics were measured"
    },
    {
      name        = "commit_frequency"
      type        = "FLOAT64"
      mode        = "NULLABLE"
      description = "Average number of commits per day"
    },
    {
      name        = "pr_merge_frequency"
      type        = "FLOAT64"
      mode        = "NULLABLE"
      description = "Average number of PR merges per day"
    },
    {
      name        = "issue_close_speed"
      type        = "FLOAT64"
      mode        = "NULLABLE"
      description = "Average hours to close an issue"
    },
    {
      name        = "contributor_count"
      type        = "INT64"
      mode        = "NULLABLE"
      description = "Number of active contributors in the measurement window"
    },
    {
      name        = "velocity_score"
      type        = "FLOAT64"
      mode        = "NULLABLE"
      description = "Composite velocity score (0.0 - 1.0)"
    },
    {
      name        = "language"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Primary programming language of the repository"
    },
    {
      name        = "repo_full_name"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Full repository name (e.g., org/repo)"
    },
    {
      name        = "idempotency_key"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Idempotency key for deduplication of ingested records"
    },
  ])

  labels = local.labels
}
