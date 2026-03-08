variable "project_id" {
  description = "GCP project ID for the staging environment"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "asia-northeast1"
}
