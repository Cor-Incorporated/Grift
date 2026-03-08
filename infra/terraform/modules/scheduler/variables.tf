variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for the scheduler job"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "schedule" {
  description = "Cron schedule expression (e.g., '0 2 * * *' for daily at 2 AM)"
  type        = string
  default     = "0 2 * * *"
}

variable "time_zone" {
  description = "IANA time zone for the schedule"
  type        = string
  default     = "Asia/Tokyo"
}

variable "target_uri" {
  description = "HTTP endpoint URI to trigger (Cloud Run job URL)"
  type        = string
}

variable "service_account_email" {
  description = "Service account email for OAuth token authentication"
  type        = string
}

variable "retry_count" {
  description = "Number of retry attempts on failure"
  type        = number
  default     = 3
}

variable "min_backoff_duration" {
  description = "Minimum backoff duration between retries"
  type        = string
  default     = "30s"
}

variable "max_backoff_duration" {
  description = "Maximum backoff duration between retries"
  type        = string
  default     = "300s"
}

variable "max_doublings" {
  description = "Maximum number of times the backoff duration is doubled"
  type        = number
  default     = 3
}

variable "labels" {
  description = "Additional labels to apply to the scheduler job"
  type        = map(string)
  default     = {}
}
