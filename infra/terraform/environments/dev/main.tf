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
