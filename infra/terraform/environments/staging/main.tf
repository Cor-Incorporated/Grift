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
# Pub/Sub
# -----------------------------------------------------
module "pubsub" {
  source = "../../modules/pubsub"

  project_id  = var.project_id
  environment = "staging"
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

  pubsub_topic_ids             = module.pubsub.topic_ids
  pubsub_subscription_ids      = module.pubsub.subscription_ids
  pubsub_dead_letter_topic_ids = module.pubsub.dead_letter_topic_ids
  source_documents_bucket_name = module.storage.source_documents_bucket_name
  exports_bucket_name          = module.storage.exports_bucket_name
}
