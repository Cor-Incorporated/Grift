# =============================================================
# GKE GPU Module — Standard Cluster + GPU Node Pool
# =============================================================
# Provisions a GKE Standard cluster with a GPU-capable node pool
# for running vLLM (Qwen3.5) inference workloads.
#
# Includes:
# - Private GKE Standard cluster with shielded nodes
# - GPU node pool with autoscaling (spot-capable)
# - Cloud Scheduler for night/weekend shutdown (cost optimization)
# - Workload Identity for GCS model cache access
# - Dedicated service accounts with least-privilege IAM
# =============================================================

# -----------------------------------------------------
# Use existing private subnet (from networking module)
# Secondary IP ranges must already exist on this subnet.
# -----------------------------------------------------

# -----------------------------------------------------
# GKE Node Pool Service Account (least-privilege)
# -----------------------------------------------------
resource "google_service_account" "gke_node" {
  project      = var.project_id
  account_id   = "bd-${var.environment}-gke-gpu-node"
  display_name = "BenevolentDirector GKE GPU Node (${var.environment})"
  description  = "Service account for GKE GPU node pool with minimal permissions"
}

resource "google_project_iam_member" "gke_node_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.gke_node.email}"
}

resource "google_project_iam_member" "gke_node_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.gke_node.email}"
}

resource "google_project_iam_member" "gke_node_monitoring_viewer" {
  project = var.project_id
  role    = "roles/monitoring.viewer"
  member  = "serviceAccount:${google_service_account.gke_node.email}"
}

resource "google_project_iam_member" "gke_node_artifact_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.gke_node.email}"
}

# -----------------------------------------------------
# GKE Standard Cluster (private, shielded)
# -----------------------------------------------------
resource "google_container_cluster" "gpu" {
  provider = google-beta
  project  = var.project_id
  name     = local.cluster_name
  location = var.region

  # Standard mode — no default node pool
  remove_default_node_pool = true
  initial_node_count       = 1

  network    = var.network_id
  subnetwork = var.private_subnet_id

  ip_allocation_policy {
    cluster_secondary_range_name  = local.pod_range_name
    services_secondary_range_name = local.service_range_name
  }

  # Private cluster configuration
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = var.master_ipv4_cidr_block
  }

  # Always enforce master authorized networks — the variable validation
  # ensures at least one CIDR block is provided so the endpoint is never
  # silently open to all IPs.
  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.master_authorized_cidr_blocks
      content {
        cidr_block   = cidr_blocks.value.cidr_block
        display_name = cidr_blocks.value.display_name
      }
    }
  }

  # Workload Identity
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Release channel for automatic upgrades
  release_channel {
    channel = var.environment == "prod" ? "STABLE" : "REGULAR"
  }

  # Logging and monitoring
  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = true
    }
  }

  # Addons
  addons_config {
    http_load_balancing {
      disabled = false
    }
    horizontal_pod_autoscaling {
      disabled = false
    }
    gce_persistent_disk_csi_driver_config {
      enabled = true
    }
  }

  resource_labels = local.labels

  # Prevent accidental deletion in staging/prod
  deletion_protection = var.environment != "dev"

  lifecycle {
    ignore_changes = [
      node_config,
      initial_node_count,
    ]
  }
}

# -----------------------------------------------------
# GPU Node Pool
# -----------------------------------------------------
resource "google_container_node_pool" "gpu" {
  provider = google-beta
  project  = var.project_id
  name     = local.node_pool_name
  location = var.region
  cluster  = google_container_cluster.gpu.name

  autoscaling {
    min_node_count = var.min_node_count
    max_node_count = var.max_node_count
  }

  node_config {
    machine_type = var.gpu_machine_type
    disk_size_gb = var.disk_size_gb
    disk_type    = "pd-ssd"

    # GPU accelerator
    guest_accelerator {
      type  = var.gpu_accelerator_type
      count = var.gpu_accelerator_count

      gpu_driver_installation_config {
        gpu_driver_version = "LATEST"
      }
    }

    # Spot instances for cost optimization
    spot = var.enable_spot

    # Service account with least-privilege
    service_account = google_service_account.gke_node.email
    oauth_scopes = [
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/devstorage.read_only",
    ]

    # Shielded instance
    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }

    # Workload Identity on nodes
    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    # Taints to ensure only GPU workloads land here
    taint {
      key    = "nvidia.com/gpu"
      value  = "present"
      effect = "NO_SCHEDULE"
    }

    labels = merge(local.labels, {
      gpu = "true"
    })

    metadata = {
      disable-legacy-endpoints = "true"
    }
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  lifecycle {
    ignore_changes = [
      # Cloud Scheduler modifies autoscaling at runtime
      autoscaling[0].max_node_count,
    ]
  }
}

# =============================================================
# Workload Identity — vLLM Service Account
# =============================================================
# Allows vLLM pods to access GCS model cache via Workload Identity

resource "google_service_account" "vllm_workload" {
  project      = var.project_id
  account_id   = "bd-${var.environment}-vllm-wi"
  display_name = "BenevolentDirector vLLM Workload Identity (${var.environment})"
  description  = "Workload Identity SA for vLLM pods to access GCS model cache"
}

# Allow K8s SA to impersonate GCP SA
resource "google_service_account_iam_member" "vllm_workload_identity" {
  service_account_id = google_service_account.vllm_workload.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${var.vllm_k8s_namespace}/${var.vllm_k8s_service_account}]"
}

# Grant GCS read access for model cache (only if bucket is specified)
resource "google_storage_bucket_iam_member" "vllm_model_cache_reader" {
  count  = var.model_cache_bucket != "" ? 1 : 0
  bucket = var.model_cache_bucket
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.vllm_workload.email}"
}

# =============================================================
# Cloud Scheduler — Night/Weekend GPU Shutdown
# =============================================================
# Uses Cloud Functions (2nd gen / Cloud Run) to resize node pool.
# The scheduler triggers an HTTP endpoint that calls the GKE API
# to update the node pool autoscaling max.

# Service account for the scheduler Cloud Function
resource "google_service_account" "gpu_scheduler" {
  count = var.enable_night_shutdown ? 1 : 0

  project      = var.project_id
  account_id   = "bd-${var.environment}-gpu-sched"
  display_name = "BenevolentDirector GPU Scheduler (${var.environment})"
  description  = "Service account for Cloud Function that resizes GPU node pool"
}

# Custom role scoped to only the permissions needed for GPU node pool resize
resource "google_project_iam_custom_role" "gpu_scheduler_role" {
  count = var.enable_night_shutdown ? 1 : 0

  project     = var.project_id
  role_id     = replace("bd_${var.environment}_gpu_scheduler", "-", "_")
  title       = "BenevolentDirector GPU Scheduler (${var.environment})"
  description = "Least-privilege role for reading cluster state and resizing GPU node pools"
  permissions = [
    "container.clusters.get",
    "container.nodePools.update",
  ]
}

# Bind the scheduler SA to the custom role instead of roles/container.developer
resource "google_project_iam_member" "gpu_scheduler_container" {
  count = var.enable_night_shutdown ? 1 : 0

  project = var.project_id
  role    = google_project_iam_custom_role.gpu_scheduler_role[0].id
  member  = "serviceAccount:${google_service_account.gpu_scheduler[0].email}"
}

# Permission to invoke Cloud Run / Cloud Functions
resource "google_project_iam_member" "gpu_scheduler_invoker" {
  count = var.enable_night_shutdown ? 1 : 0

  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.gpu_scheduler[0].email}"
}

# Cloud Function (2nd gen) for GPU node pool resize
resource "google_cloudfunctions2_function" "gpu_resize" {
  count = var.enable_night_shutdown ? 1 : 0

  project  = var.project_id
  name     = "bd-${var.environment}-gpu-resize"
  location = var.region

  description = "Resizes GPU node pool autoscaling max for cost optimization"

  build_config {
    runtime     = "python312"
    entry_point = "resize_gpu_pool"

    source {
      storage_source {
        bucket = google_storage_bucket.scheduler_source[0].name
        object = google_storage_bucket_object.resize_function_source[0].name
      }
    }
  }

  service_config {
    min_instance_count    = 0
    max_instance_count    = 1
    timeout_seconds       = 120
    service_account_email = google_service_account.gpu_scheduler[0].email

    environment_variables = {
      PROJECT_ID     = var.project_id
      REGION         = var.region
      CLUSTER_NAME   = local.cluster_name
      NODE_POOL_NAME = local.node_pool_name
    }
  }

  labels = local.labels
}

# GCS bucket for Cloud Function source
resource "google_storage_bucket" "scheduler_source" {
  count = var.enable_night_shutdown ? 1 : 0

  project                     = var.project_id
  name                        = "${var.project_id}-bd-${var.environment}-gpu-scheduler-src"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  labels = local.labels
}

# Cloud Function source code (inline archive)
resource "google_storage_bucket_object" "resize_function_source" {
  count = var.enable_night_shutdown ? 1 : 0

  name   = "gpu-resize-source-${filemd5("${path.module}/functions/resize_gpu_pool.zip")}.zip"
  bucket = google_storage_bucket.scheduler_source[0].name
  source = "${path.module}/functions/resize_gpu_pool.zip"
}

# --- Scale Down: weekday nights (22:00 JST) ---
resource "google_cloud_scheduler_job" "gpu_scale_down" {
  count = var.enable_night_shutdown ? 1 : 0

  project     = var.project_id
  region      = var.region
  name        = "bd-${var.environment}-gpu-scale-down"
  description = "Scale down GPU node pool at night (max_nodes=0)"

  schedule  = var.shutdown_cron
  time_zone = var.scheduler_timezone

  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "120s"
    max_doublings        = 3
  }

  http_target {
    http_method = "POST"
    uri         = google_cloudfunctions2_function.gpu_resize[0].url

    oauth_token {
      service_account_email = google_service_account.gpu_scheduler[0].email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      action    = "scale_down"
      max_nodes = 0
    }))
  }
}

# --- Scale Up: weekday mornings (08:00 JST) ---
resource "google_cloud_scheduler_job" "gpu_scale_up" {
  count = var.enable_night_shutdown ? 1 : 0

  project     = var.project_id
  region      = var.region
  name        = "bd-${var.environment}-gpu-scale-up"
  description = "Scale up GPU node pool in the morning (max_nodes=${var.max_node_count})"

  schedule  = var.startup_cron
  time_zone = var.scheduler_timezone

  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "120s"
    max_doublings        = 3
  }

  http_target {
    http_method = "POST"
    uri         = google_cloudfunctions2_function.gpu_resize[0].url

    oauth_token {
      service_account_email = google_service_account.gpu_scheduler[0].email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      action    = "scale_up"
      max_nodes = var.max_node_count
    }))
  }
}

# --- Weekend Shutdown: Friday 22:00 JST (no Saturday scale-up) ---
resource "google_cloud_scheduler_job" "gpu_weekend_shutdown" {
  count = var.enable_night_shutdown ? 1 : 0

  project     = var.project_id
  region      = var.region
  name        = "bd-${var.environment}-gpu-weekend-off"
  description = "Ensure GPU node pool stays off during weekends (max_nodes=0)"

  schedule  = var.weekend_shutdown_cron
  time_zone = var.scheduler_timezone

  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "120s"
    max_doublings        = 3
  }

  http_target {
    http_method = "POST"
    uri         = google_cloudfunctions2_function.gpu_resize[0].url

    oauth_token {
      service_account_email = google_service_account.gpu_scheduler[0].email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      action    = "scale_down"
      max_nodes = 0
    }))
  }
}
