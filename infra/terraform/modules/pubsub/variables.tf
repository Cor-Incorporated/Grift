variable "project_id" {
  description = "GCP project ID"
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

variable "topic_names" {
  description = "List of Pub/Sub topic names to create"
  type        = list(string)
  default = [
    "case-events",
    "estimate-events",
    "handoff-events",
    "velocity-events",
    "market-events",
  ]
}

variable "message_retention_duration" {
  description = "Duration to retain messages on topics (e.g., 86400s = 24h)"
  type        = string
  default     = "86400s"
}

variable "ack_deadline_seconds" {
  description = "Acknowledgement deadline for subscriptions in seconds"
  type        = number
  default     = 60
}

variable "max_delivery_attempts" {
  description = "Maximum number of delivery attempts before sending to dead letter"
  type        = number
  default     = 5
}

variable "minimum_backoff" {
  description = "Minimum backoff duration for retry policy"
  type        = string
  default     = "10s"
}

variable "maximum_backoff" {
  description = "Maximum backoff duration for retry policy"
  type        = string
  default     = "600s"
}

variable "labels" {
  description = "Additional labels to apply to resources"
  type        = map(string)
  default     = {}
}

variable "enable_dlq_alerts" {
  description = "Whether to enable DLQ non-empty alert policies"
  type        = bool
  default     = true
}

variable "notification_channel_ids" {
  description = "Cloud Monitoring notification channel IDs for DLQ alerts"
  type        = list(string)
  default     = []
}
