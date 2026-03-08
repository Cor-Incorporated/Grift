# -----------------------------------------------------
# Suffix for instance name uniqueness on recreation
# -----------------------------------------------------
resource "random_id" "db_suffix" {
  byte_length = 4
}

# -----------------------------------------------------
# Cloud SQL PostgreSQL 16 Instance
# -----------------------------------------------------
resource "google_sql_database_instance" "main" {
  provider = google-beta

  project             = var.project_id
  name                = "${local.instance_name}-${random_id.db_suffix.hex}"
  region              = var.region
  database_version    = var.database_version
  deletion_protection = var.deletion_protection

  depends_on = [var.private_services_connection]

  settings {
    tier              = var.instance_tier
    disk_size         = var.disk_size
    disk_type         = "PD_SSD"
    disk_autoresize   = var.disk_autoresize
    availability_type = var.ha_enabled ? "REGIONAL" : "ZONAL"

    disk_autoresize_limit = var.disk_autoresize_limit

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network_id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = var.backup_enabled
      start_time                     = var.backup_start_time
      point_in_time_recovery_enabled = var.backup_enabled
      transaction_log_retention_days = var.backup_transaction_log_retention_days
      backup_retention_settings {
        retained_backups = var.backup_retained_count
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = var.maintenance_window_day
      hour         = var.maintenance_window_hour
      update_track = "stable"
    }

    # pgvector extension requires cloudsql.enable_pgvector flag
    database_flags {
      name  = "cloudsql.enable_pgvector"
      value = "on"
    }

    # Logging slow queries (> 1 second)
    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }

    # Enable pg_trgm for fuzzy search (used in schema)
    database_flags {
      name  = "cloudsql.enable_pg_trgm"
      value = "on"
    }

    user_labels = local.labels

    insights_config {
      query_insights_enabled  = true
      query_plans_per_minute  = 5
      query_string_length     = 4096
      record_application_tags = true
      record_client_address   = false
    }
  }

  lifecycle {
    prevent_destroy = false
  }
}

# -----------------------------------------------------
# Default Database
# -----------------------------------------------------
resource "google_sql_database" "default" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = var.database_name
}

# -----------------------------------------------------
# Application Database User
# -----------------------------------------------------
resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = "bd_app"
  password = random_password.db_password.result
}
