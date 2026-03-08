# =============================================================
# Cloud Scheduler — Periodic Crawl Job Trigger
# =============================================================
# Triggers the crawler Cloud Run job via HTTP POST on a cron schedule.
# Uses OAuth token for authentication against the target service.
# =============================================================

resource "google_cloud_scheduler_job" "crawl" {
  project     = var.project_id
  region      = var.region
  name        = "bd-${var.environment}-crawl-job"
  description = "Triggers the repository crawl job to discover repos and extract velocity metrics"

  schedule  = var.schedule
  time_zone = var.time_zone

  retry_config {
    retry_count          = var.retry_count
    min_backoff_duration = var.min_backoff_duration
    max_backoff_duration = var.max_backoff_duration
    max_doublings        = var.max_doublings
  }

  http_target {
    http_method = "POST"
    uri         = var.target_uri

    oauth_token {
      service_account_email = var.service_account_email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      source = "cloud-scheduler"
    }))
  }

  labels = merge(local.labels, var.labels)
}

locals {
  labels = {
    app         = "benevolentdirector"
    environment = var.environment
    component   = "scheduler"
    managed_by  = "terraform"
  }
}
