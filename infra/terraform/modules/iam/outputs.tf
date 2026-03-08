output "control_api_service_account_email" {
  description = "Email of the control-api service account"
  value       = google_service_account.control_api.email
}

output "control_api_service_account_id" {
  description = "Unique ID of the control-api service account"
  value       = google_service_account.control_api.unique_id
}

output "intelligence_worker_service_account_email" {
  description = "Email of the intelligence-worker service account"
  value       = google_service_account.intelligence_worker.email
}

output "intelligence_worker_service_account_id" {
  description = "Unique ID of the intelligence-worker service account"
  value       = google_service_account.intelligence_worker.unique_id
}

output "llm_gateway_service_account_email" {
  description = "Email of the llm-gateway service account"
  value       = google_service_account.llm_gateway.email
}

output "llm_gateway_service_account_id" {
  description = "Unique ID of the llm-gateway service account"
  value       = google_service_account.llm_gateway.unique_id
}

output "web_deploy_service_account_email" {
  description = "Email of the web-deploy service account"
  value       = google_service_account.web_deploy.email
}

output "web_deploy_service_account_id" {
  description = "Unique ID of the web-deploy service account"
  value       = google_service_account.web_deploy.unique_id
}
