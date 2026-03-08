variable "project_id" {
  description = "GCP project ID"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid GCP project ID (6-30 chars, lowercase, hyphens allowed)."
  }
}

variable "region" {
  description = "GCP region for networking resources"
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

variable "vpc_name" {
  description = "Name of the VPC network"
  type        = string
  default     = ""
}

variable "public_subnet_cidr" {
  description = "CIDR range for the public subnet (load balancers)"
  type        = string
  default     = "10.0.1.0/24"
}

variable "private_subnet_cidr" {
  description = "CIDR range for the private subnet (Cloud SQL, GKE)"
  type        = string
  default     = "10.0.2.0/24"
}

variable "private_services_cidr" {
  description = "CIDR range for private services access (VPC peering for Cloud SQL)"
  type        = string
  default     = "10.0.128.0/20"
}

variable "labels" {
  description = "Additional labels to apply to resources"
  type        = map(string)
  default     = {}
}
