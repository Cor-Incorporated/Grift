variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for storage buckets"
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

variable "archive_age_days" {
  description = "Number of days before objects transition to ARCHIVE storage class"
  type        = number
  default     = 90
}

variable "force_destroy" {
  description = "Allow buckets to be destroyed even with objects inside (for non-prod)"
  type        = bool
  default     = false
}

variable "labels" {
  description = "Additional labels to apply to resources"
  type        = map(string)
  default     = {}
}
