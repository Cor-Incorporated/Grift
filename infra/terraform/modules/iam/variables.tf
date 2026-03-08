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

variable "pubsub_topic_ids" {
  description = "Map of Pub/Sub topic name to topic ID (for IAM bindings)"
  type        = map(string)
  default     = {}
}

variable "pubsub_subscription_ids" {
  description = "Map of Pub/Sub subscription name to subscription ID (for IAM bindings)"
  type        = map(string)
  default     = {}
}

variable "pubsub_dead_letter_topic_ids" {
  description = "Map of dead letter topic name to topic ID (for subscriber write-back)"
  type        = map(string)
  default     = {}
}

variable "source_documents_bucket_name" {
  description = "Name of the source documents GCS bucket"
  type        = string
  default     = ""
}

variable "exports_bucket_name" {
  description = "Name of the exports GCS bucket"
  type        = string
  default     = ""
}
