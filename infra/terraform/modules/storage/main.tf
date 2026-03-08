# -----------------------------------------------------
# Source Documents Bucket (per-tenant prefix structure)
# Stores uploaded files, repository archives, website snapshots
# -----------------------------------------------------
resource "google_storage_bucket" "source_documents" {
  project  = var.project_id
  name     = "${var.project_id}-bd-${var.environment}-source-documents"
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = var.force_destroy
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = var.archive_age_days
    }
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }

  labels = local.labels
}

# -----------------------------------------------------
# Export / Report Bucket
# Stores generated estimates, proposals, handoff packages
# -----------------------------------------------------
resource "google_storage_bucket" "exports" {
  project  = var.project_id
  name     = "${var.project_id}-bd-${var.environment}-exports"
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = var.force_destroy
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = var.archive_age_days
    }
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }

  labels = local.labels
}
