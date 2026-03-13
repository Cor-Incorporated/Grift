# -----------------------------------------------------
# GKE Cluster
# -----------------------------------------------------
output "cluster_name" {
  description = "The name of the GKE cluster"
  value       = google_container_cluster.gpu.name
}

output "cluster_id" {
  description = "The unique identifier of the GKE cluster"
  value       = google_container_cluster.gpu.id
}

output "cluster_endpoint" {
  description = "The IP address of the GKE cluster master endpoint"
  value       = google_container_cluster.gpu.endpoint
  sensitive   = true
}

output "cluster_ca_certificate" {
  description = "Base64 encoded public certificate of the cluster CA"
  value       = google_container_cluster.gpu.master_auth[0].cluster_ca_certificate
  sensitive   = true
}

# -----------------------------------------------------
# GPU Node Pool
# -----------------------------------------------------
output "node_pool_name" {
  description = "The name of the GPU node pool"
  value       = google_container_node_pool.gpu.name
}

# -----------------------------------------------------
# Workload Identity
# -----------------------------------------------------
output "workload_identity_pool" {
  description = "Workload Identity pool for the cluster"
  value       = "${var.project_id}.svc.id.goog"
}

output "vllm_service_account_email" {
  description = "Email of the vLLM Workload Identity service account"
  value       = google_service_account.vllm_workload.email
}

# -----------------------------------------------------
# Node Service Account
# -----------------------------------------------------
output "gpu_node_service_account_email" {
  description = "Email of the GPU node pool service account"
  value       = google_service_account.gke_node.email
}

# -----------------------------------------------------
# Scheduler
# -----------------------------------------------------
output "gpu_scheduler_service_account_email" {
  description = "Email of the GPU scheduler service account (empty if scheduler disabled)"
  value       = var.enable_night_shutdown ? google_service_account.gpu_scheduler[0].email : ""
}

output "gpu_resize_function_url" {
  description = "URL of the GPU resize Cloud Function (empty if scheduler disabled)"
  value       = var.enable_night_shutdown ? google_cloudfunctions2_function.gpu_resize[0].url : ""
}
