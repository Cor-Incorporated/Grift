output "dataset_id" {
  description = "The ID of the BigQuery dataset"
  value       = google_bigquery_dataset.velocity.dataset_id
}

output "table_id" {
  description = "The ID of the velocity metrics history table"
  value       = google_bigquery_table.velocity_metrics_history.table_id
}

output "dataset_self_link" {
  description = "The self link of the BigQuery dataset"
  value       = google_bigquery_dataset.velocity.self_link
}
