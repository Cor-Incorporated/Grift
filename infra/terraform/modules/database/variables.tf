variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud SQL instance"
  type        = string
  default     = "asia-northeast1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "network_id" {
  description = "VPC network ID for private IP connectivity"
  type        = string
}

variable "private_services_connection" {
  description = "Private services connection dependency (from networking module)"
  type        = any
}

variable "instance_tier" {
  description = "Cloud SQL machine tier (e.g., db-custom-2-7680, db-f1-micro)"
  type        = string
  default     = "db-custom-2-7680"
}

variable "disk_size" {
  description = "Disk size in GB for Cloud SQL instance"
  type        = number
  default     = 20

  validation {
    condition     = var.disk_size >= 10
    error_message = "disk_size must be at least 10 GB."
  }
}

variable "disk_autoresize" {
  description = "Enable automatic disk size increase"
  type        = bool
  default     = true
}

variable "disk_autoresize_limit" {
  description = "Maximum disk size in GB for autoresize (0 = unlimited)"
  type        = number
  default     = 100
}

variable "ha_enabled" {
  description = "Enable high availability (regional) for Cloud SQL"
  type        = bool
  default     = false
}

variable "database_name" {
  description = "Name of the default database"
  type        = string
  default     = "benevolent_director"
}

variable "database_version" {
  description = "PostgreSQL version for Cloud SQL"
  type        = string
  default     = "POSTGRES_16"
}

variable "backup_enabled" {
  description = "Enable automated backups"
  type        = bool
  default     = true
}

variable "backup_start_time" {
  description = "Start time for automated backups (HH:MM in UTC)"
  type        = string
  default     = "03:00"
}

variable "backup_transaction_log_retention_days" {
  description = "Number of days to retain transaction logs for PITR"
  type        = number
  default     = 7
}

variable "backup_retained_count" {
  description = "Number of automated backups to retain"
  type        = number
  default     = 7
}

variable "maintenance_window_day" {
  description = "Day of week for maintenance window (1=Monday, 7=Sunday)"
  type        = number
  default     = 7
}

variable "maintenance_window_hour" {
  description = "Hour of day for maintenance window (0-23, UTC)"
  type        = number
  default     = 4
}

variable "deletion_protection" {
  description = "Enable deletion protection for the Cloud SQL instance"
  type        = bool
  default     = true
}

variable "labels" {
  description = "Additional labels to apply to resources"
  type        = map(string)
  default     = {}
}
