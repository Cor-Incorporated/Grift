locals {
  cluster_name   = "bd-${var.environment}-gke-gpu"
  node_pool_name = "bd-${var.environment}-gpu-pool"

  default_labels = {
    environment = var.environment
    project     = "benevolent-director"
    managed_by  = "terraform"
    component   = "gke-gpu"
  }

  labels = merge(local.default_labels, var.labels)

  # Secondary range names (must match ranges on the existing private subnet)
  pod_range_name     = var.pod_secondary_range_name != "" ? var.pod_secondary_range_name : "bd-${var.environment}-gke-pods"
  service_range_name = var.services_secondary_range_name != "" ? var.services_secondary_range_name : "bd-${var.environment}-gke-services"
}
