# =============================================================
# BenevolentDirector v2 — Dev Environment
# =============================================================
# Small instance tiers, single zone, minimal redundancy.
# Suitable for development and testing.
# =============================================================

terraform {
  required_version = ">= 1.5.0"

  backend "gcs" {
    bucket = "bd-terraform-state"
    prefix = "environments/dev"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

# -----------------------------------------------------
# Providers
# -----------------------------------------------------
provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# -----------------------------------------------------
# Networking
# -----------------------------------------------------
module "networking" {
  source = "../../modules/networking"

  project_id  = var.project_id
  region      = var.region
  environment = "dev"

  public_subnet_cidr    = "10.10.1.0/24"
  private_subnet_cidr   = "10.10.2.0/24"
  private_services_cidr = "10.10.128.0/20"
}

# -----------------------------------------------------
# Database (Cloud SQL PostgreSQL 16 + pgvector)
# -----------------------------------------------------
module "database" {
  source = "../../modules/database"

  project_id  = var.project_id
  region      = var.region
  environment = "dev"

  network_id                  = module.networking.network_id
  private_services_connection = module.networking.private_services_connection

  instance_tier       = "db-f1-micro"
  disk_size           = 10
  ha_enabled          = false
  deletion_protection = false

  backup_enabled        = true
  backup_retained_count = 3
}

# -----------------------------------------------------
# Storage (GCS Buckets)
# -----------------------------------------------------
module "storage" {
  source = "../../modules/storage"

  project_id    = var.project_id
  region        = var.region
  environment   = "dev"
  force_destroy = true
}

# -----------------------------------------------------
# Pub/Sub
# -----------------------------------------------------
module "pubsub" {
  source = "../../modules/pubsub"

  project_id  = var.project_id
  environment = "dev"

  topic_names = [
    "conversation-turns",
    "observation-events",
    "case-events",
    "estimate-events",
    "handoff-events",
    "velocity-events",
    "market-events",
  ]

  ack_deadline_seconds = 60
  max_delivery_attempts = 5
  minimum_backoff = "10s"
  maximum_backoff = "300s"
}

# -----------------------------------------------------
# BigQuery (Velocity Analytics)
# -----------------------------------------------------
module "bigquery" {
  source = "../../modules/bigquery"

  project_id  = var.project_id
  region      = var.region
  environment = "dev"

  expiration_days            = 90
  delete_contents_on_destroy = true
  deletion_protection        = false
}

# -----------------------------------------------------
# IAM (Service Accounts + Permissions)
# -----------------------------------------------------
module "iam" {
  source = "../../modules/iam"

  project_id  = var.project_id
  environment = "dev"

  pubsub_topic_ids             = module.pubsub.topic_ids
  pubsub_subscription_ids      = module.pubsub.subscription_ids
  pubsub_dead_letter_topic_ids = module.pubsub.dead_letter_topic_ids
  source_documents_bucket_name = module.storage.source_documents_bucket_name
  exports_bucket_name          = module.storage.exports_bucket_name
}

# -----------------------------------------------------
# Scheduler (Cloud Scheduler — Crawl Job Trigger)
# -----------------------------------------------------
module "scheduler" {
  source = "../../modules/scheduler"

  project_id  = var.project_id
  region      = var.region
  environment = "dev"

  schedule              = "0 3 * * *" # 3 AM JST daily
  target_uri            = "https://bd-dev-crawler-${var.region}.a.run.app"
  service_account_email = module.iam.control_api_service_account_email
}

# -----------------------------------------------------
# GKE GPU (vLLM Qwen3.5 Inference — Issue #88, #90)
# -----------------------------------------------------
module "gke_gpu" {
  source = "../../modules/gke-gpu"

  project_id  = var.project_id
  region      = var.region
  environment = "dev"

  network_id        = module.networking.network_id
  private_subnet_id = module.networking.private_subnet_id

  # Dev: L4 GPU with Spot instances, minimal scaling
  gpu_machine_type      = "g2-standard-8"
  gpu_accelerator_type  = "nvidia-l4"
  gpu_accelerator_count = 1
  max_node_count        = 1
  min_node_count        = 0
  enable_spot           = true
  disk_size_gb          = 100

  # Dev: VPC-internal only (GHA runners and Cloud Build operate within VPC)
  master_authorized_cidr_blocks = [
    { cidr_block = "10.0.0.0/8", display_name = "internal-vpc" },
  ]

  # Night/weekend shutdown for cost optimization (Issue #90)
  enable_night_shutdown = true
  scheduler_timezone    = "Asia/Tokyo"

  # Model cache bucket (from storage module, optional)
  model_cache_bucket = ""
}
