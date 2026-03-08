output "source_documents_bucket_name" {
  description = "Name of the source documents GCS bucket"
  value       = google_storage_bucket.source_documents.name
}

output "source_documents_bucket_url" {
  description = "URL of the source documents GCS bucket"
  value       = google_storage_bucket.source_documents.url
}

output "exports_bucket_name" {
  description = "Name of the exports/reports GCS bucket"
  value       = google_storage_bucket.exports.name
}

output "exports_bucket_url" {
  description = "URL of the exports/reports GCS bucket"
  value       = google_storage_bucket.exports.url
}
