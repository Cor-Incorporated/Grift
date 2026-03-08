variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for BigQuery dataset"
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

variable "dataset_id" {
  description = "BigQuery dataset ID"
  type        = string
  default     = "velocity_analytics"
}

variable "table_id" {
  description = "BigQuery table ID for velocity metrics history"
  type        = string
  default     = "velocity_metrics_history"
}

variable "expiration_days" {
  description = "Number of days before table data expires"
  type        = number
  default     = 365

  validation {
    condition     = var.expiration_days >= 1
    error_message = "expiration_days must be at least 1."
  }
}

variable "delete_contents_on_destroy" {
  description = "Whether to delete dataset contents when the resource is destroyed"
  type        = bool
  default     = false
}

variable "labels" {
  description = "Additional labels to apply to resources"
  type        = map(string)
  default     = {}
}
