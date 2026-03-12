variable "project_id" {
  description = "GCP project ID"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid GCP project ID (6-30 chars, lowercase, hyphens allowed)."
  }
}

variable "region" {
  description = "GCP region for GKE cluster"
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
  description = "VPC network ID (from networking module)"
  type        = string
}

variable "private_subnet_id" {
  description = "Private subnet ID for GKE nodes (from networking module)"
  type        = string
}

# -----------------------------------------------------
# GKE Cluster Configuration
# -----------------------------------------------------

variable "master_authorized_cidr_blocks" {
  description = "CIDR blocks authorized to access the GKE master endpoint. Must not be empty — explicitly specify allowed CIDRs to avoid an open master endpoint."
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
  # No default — callers must explicitly provide authorized CIDRs.
  # To allow all access (NOT recommended for production), pass:
  #   [{ cidr_block = "0.0.0.0/0", display_name = "all-access" }]

  validation {
    condition     = length(var.master_authorized_cidr_blocks) > 0
    error_message = "master_authorized_cidr_blocks must contain at least one entry. An empty list would leave the GKE master endpoint open to all IPs."
  }
}

variable "master_ipv4_cidr_block" {
  description = "CIDR block for the GKE master endpoint (must be /28)"
  type        = string
  default     = "172.16.0.0/28"

  validation {
    condition     = can(cidrhost(var.master_ipv4_cidr_block, 0)) && endswith(var.master_ipv4_cidr_block, "/28")
    error_message = "master_ipv4_cidr_block must be a valid /28 CIDR block."
  }
}

variable "cluster_secondary_range_cidr" {
  description = "Secondary CIDR range for GKE pods"
  type        = string
  default     = "10.20.0.0/16"
}

variable "services_secondary_range_cidr" {
  description = "Secondary CIDR range for GKE services"
  type        = string
  default     = "10.21.0.0/20"
}

# -----------------------------------------------------
# GPU Node Pool Configuration
# -----------------------------------------------------

variable "gpu_machine_type" {
  description = "Machine type for GPU nodes (g2-standard-8 for L4, a2-highgpu-1g for A100)"
  type        = string
  default     = "g2-standard-8"

  validation {
    condition     = contains(["g2-standard-8", "g2-standard-12", "g2-standard-16", "a2-highgpu-1g", "a2-highgpu-2g"], var.gpu_machine_type)
    error_message = "gpu_machine_type must be a valid GPU-capable machine type."
  }
}

variable "gpu_accelerator_type" {
  description = "GPU accelerator type (nvidia-l4, nvidia-tesla-a100)"
  type        = string
  default     = "nvidia-l4"

  validation {
    condition     = contains(["nvidia-l4", "nvidia-tesla-a100", "nvidia-tesla-t4"], var.gpu_accelerator_type)
    error_message = "gpu_accelerator_type must be a supported GPU accelerator."
  }
}

variable "gpu_accelerator_count" {
  description = "Number of GPUs per node"
  type        = number
  default     = 1

  validation {
    condition     = var.gpu_accelerator_count >= 1 && var.gpu_accelerator_count <= 8
    error_message = "gpu_accelerator_count must be between 1 and 8."
  }
}

variable "max_node_count" {
  description = "Maximum number of GPU nodes for autoscaling"
  type        = number
  default     = 1

  validation {
    condition     = var.max_node_count >= 0 && var.max_node_count <= 10
    error_message = "max_node_count must be between 0 and 10."
  }
}

variable "min_node_count" {
  description = "Minimum number of GPU nodes for autoscaling"
  type        = number
  default     = 0

  validation {
    condition     = var.min_node_count >= 0
    error_message = "min_node_count must be >= 0."
  }
}

variable "enable_spot" {
  description = "Use Spot VMs for GPU nodes (cheaper but preemptible)"
  type        = bool
  default     = true
}

variable "disk_size_gb" {
  description = "Boot disk size in GB for GPU nodes"
  type        = number
  default     = 100

  validation {
    condition     = var.disk_size_gb >= 50 && var.disk_size_gb <= 500
    error_message = "disk_size_gb must be between 50 and 500."
  }
}

# -----------------------------------------------------
# Night Shutdown Scheduler
# -----------------------------------------------------

variable "enable_night_shutdown" {
  description = "Enable Cloud Scheduler for night/weekend GPU shutdown"
  type        = bool
  default     = true
}

variable "scheduler_timezone" {
  description = "Timezone for shutdown scheduler"
  type        = string
  default     = "Asia/Tokyo"
}

variable "shutdown_cron" {
  description = "Cron expression for scaling down (weekday nights)"
  type        = string
  default     = "0 22 * * 1-5"
}

variable "startup_cron" {
  description = "Cron expression for scaling up (weekday mornings)"
  type        = string
  default     = "0 8 * * 1-5"
}

variable "weekend_shutdown_cron" {
  description = "Cron expression for weekend shutdown (Friday night covers weekends)"
  type        = string
  default     = "0 22 * * 5"
}

# -----------------------------------------------------
# Workload Identity
# -----------------------------------------------------

variable "vllm_k8s_namespace" {
  description = "Kubernetes namespace for vLLM workloads"
  type        = string
  default     = "llm"
}

variable "vllm_k8s_service_account" {
  description = "Kubernetes service account name for vLLM pods"
  type        = string
  default     = "vllm-sa"
}

variable "model_cache_bucket" {
  description = "GCS bucket name for model cache (optional, created externally)"
  type        = string
  default     = ""
}

# -----------------------------------------------------
# Labels
# -----------------------------------------------------

variable "labels" {
  description = "Additional labels to apply to resources"
  type        = map(string)
  default     = {}
}
