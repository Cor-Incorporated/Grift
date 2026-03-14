# =============================================================
# BenevolentDirector v2 — Staging Environment
# =============================================================
# Regional HA for Cloud SQL, production-like configuration.
# Used for pre-production validation and integration testing.
# =============================================================

terraform {
  required_version = ">= 1.5.0"

  backend "gcs" {
    bucket = "bd-terraform-state"
    prefix = "environments/staging"
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
  environment = "staging"

  public_subnet_cidr    = "10.20.1.0/24"
  private_subnet_cidr   = "10.20.2.0/24"
  private_services_cidr = "10.20.128.0/20"

  # GKE secondary ranges (must not overlap with primary or private_services)
  gke_pods_cidr     = "10.20.16.0/20"
  gke_services_cidr = "10.20.32.0/24"
}

# -----------------------------------------------------
# Database (Cloud SQL PostgreSQL 16 + pgvector)
# Regional HA enabled for staging
# -----------------------------------------------------
module "database" {
  source = "../../modules/database"

  project_id  = var.project_id
  region      = var.region
  environment = "staging"

  network_id                  = module.networking.network_id
  private_services_connection = module.networking.private_services_connection

  instance_tier       = "db-custom-2-7680"
  disk_size           = 20
  ha_enabled          = true
  deletion_protection = true

  backup_enabled        = true
  backup_retained_count = 7
}

# -----------------------------------------------------
# Storage (GCS Buckets)
# -----------------------------------------------------
module "storage" {
  source = "../../modules/storage"

  project_id    = var.project_id
  region        = var.region
  environment   = "staging"
  force_destroy = false
}

# -----------------------------------------------------
# Secrets (Secret Manager)
# -----------------------------------------------------
module "secrets" {
  source = "../../modules/secrets"

  project_id  = var.project_id
  environment = "staging"

  secret_names = [
    "control-api-database-url",
    "cloudsql-db-password",
    "anthropic-api-key",
    "brave-search-api-key",
    "xai-api-key",
    "firebase-api-key",
    "firebase-service-account-key",
    "github-token",
    "github-app-private-key",
    "github-app-id",
    "github-app-installation-id",
    "control-api-token",
    "perplexity-api-key",
    "gemini-api-key",
    "clerk-secret-key",
    "supabase-service-role-key",
    "linear-api-key",
  ]
}

# -----------------------------------------------------
# Pub/Sub
# -----------------------------------------------------
module "pubsub" {
  source = "../../modules/pubsub"

  project_id  = var.project_id
  environment = "staging"

  topic_names = [
    "conversation-turns",
    "observation-events",
    "case-events",
    "estimate-events",
    "handoff-events",
    "velocity-events",
    "market-events",
  ]

  ack_deadline_seconds  = 60
  max_delivery_attempts = 5
  minimum_backoff       = "10s"
  maximum_backoff       = "300s"
}

# -----------------------------------------------------
# BigQuery (Velocity Analytics)
# -----------------------------------------------------
module "bigquery" {
  source = "../../modules/bigquery"

  project_id  = var.project_id
  region      = var.region
  environment = "staging"

  expiration_days            = 365
  delete_contents_on_destroy = false
}

# -----------------------------------------------------
# IAM (Service Accounts + Permissions)
# -----------------------------------------------------
module "iam" {
  source = "../../modules/iam"

  project_id  = var.project_id
  environment = "staging"

  pubsub_topic_ids               = module.pubsub.topic_ids
  pubsub_subscription_ids        = module.pubsub.subscription_ids
  pubsub_dead_letter_topic_ids   = module.pubsub.dead_letter_topic_ids
  source_documents_bucket_name   = module.storage.source_documents_bucket_name
  exports_bucket_name            = module.storage.exports_bucket_name
  control_api_secret_ids         = values(module.secrets.secret_ids)
  intelligence_worker_secret_ids = values(module.secrets.secret_ids)
  llm_gateway_secret_ids         = values(module.secrets.secret_ids)
  web_deploy_secret_ids          = values(module.secrets.secret_ids)
}

# -----------------------------------------------------
# Scheduler (Cloud Scheduler — Crawl Job Trigger)
# -----------------------------------------------------
module "scheduler" {
  source = "../../modules/scheduler"

  project_id  = var.project_id
  region      = var.region
  environment = "staging"

  schedule              = "0 2 * * *" # 2 AM JST daily
  target_uri            = "https://bd-staging-crawler-${var.region}.a.run.app"
  service_account_email = module.iam.control_api_service_account_email
}

# -----------------------------------------------------
# GKE GPU (vLLM Qwen3.5 Inference — production-like)
# Staging mirrors prod topology for pre-release validation.
# -----------------------------------------------------
module "gke_gpu" {
  source = "../../modules/gke-gpu"

  project_id  = var.project_id
  region      = var.region
  environment = "staging"

  network_id        = module.networking.network_id
  private_subnet_id = module.networking.private_subnet_id

  # Staging: L4 GPU with Spot instances, same topology as prod
  gpu_machine_type      = "g2-standard-8"
  gpu_accelerator_type  = "nvidia-l4"
  gpu_accelerator_count = 1
  max_node_count        = 1
  min_node_count        = 0
  enable_spot           = true
  disk_size_gb          = 100

  # Staging: VPC-internal only
  master_authorized_cidr_blocks = [
    { cidr_block = "10.0.0.0/8", display_name = "internal-vpc" },
  ]

  # Night/weekend shutdown for cost optimization
  enable_night_shutdown = true
  scheduler_timezone    = "Asia/Tokyo"

  model_cache_bucket = ""
}
