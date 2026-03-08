# -----------------------------------------------------
# Networking
# -----------------------------------------------------
output "network_name" {
  description = "VPC network name"
  value       = module.networking.network_name
}

# -----------------------------------------------------
# Database
# -----------------------------------------------------
output "database_connection_name" {
  description = "Cloud SQL connection name for proxy"
  value       = module.database.connection_name
}

output "database_private_ip" {
  description = "Cloud SQL private IP address"
  value       = module.database.private_ip
}

output "database_name" {
  description = "Database name"
  value       = module.database.database_name
}

# -----------------------------------------------------
# Storage
# -----------------------------------------------------
output "source_documents_bucket" {
  description = "Source documents bucket name"
  value       = module.storage.source_documents_bucket_name
}

output "exports_bucket" {
  description = "Exports bucket name"
  value       = module.storage.exports_bucket_name
}

# -----------------------------------------------------
# Pub/Sub
# -----------------------------------------------------
output "pubsub_topics" {
  description = "Pub/Sub topic names"
  value       = module.pubsub.topic_names
}

# -----------------------------------------------------
# IAM
# -----------------------------------------------------
output "control_api_sa_email" {
  description = "Control API service account email"
  value       = module.iam.control_api_service_account_email
}

output "intelligence_worker_sa_email" {
  description = "Intelligence Worker service account email"
  value       = module.iam.intelligence_worker_service_account_email
}

output "llm_gateway_sa_email" {
  description = "LLM Gateway service account email"
  value       = module.iam.llm_gateway_service_account_email
}
