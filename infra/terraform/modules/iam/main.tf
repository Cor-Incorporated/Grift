# =============================================================
# Service Accounts
# =============================================================

# control-api: Go API server
resource "google_service_account" "control_api" {
  project      = var.project_id
  account_id   = "bd-${var.environment}-control-api"
  display_name = "BenevolentDirector Control API (${var.environment})"
  description  = "Service account for the Control API (Go) service"
}

# intelligence-worker: Python async worker
resource "google_service_account" "intelligence_worker" {
  project      = var.project_id
  account_id   = "bd-${var.environment}-intel-worker"
  display_name = "BenevolentDirector Intelligence Worker (${var.environment})"
  description  = "Service account for the Intelligence Worker (Python) service"
}

# llm-gateway: Python LLM router
resource "google_service_account" "llm_gateway" {
  project      = var.project_id
  account_id   = "bd-${var.environment}-llm-gateway"
  display_name = "BenevolentDirector LLM Gateway (${var.environment})"
  description  = "Service account for the LLM Gateway (Python) service"
}

# web-deploy: React frontend deployment
resource "google_service_account" "web_deploy" {
  project      = var.project_id
  account_id   = "bd-${var.environment}-web-deploy"
  display_name = "BenevolentDirector Web Deploy (${var.environment})"
  description  = "Service account for React frontend deployment"
}

# =============================================================
# control-api permissions
# - Cloud SQL Client (connect via proxy)
# - Pub/Sub Publisher (publish domain events)
# =============================================================
resource "google_project_iam_member" "control_api_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.control_api.email}"
}

resource "google_pubsub_topic_iam_member" "control_api_publisher" {
  for_each = var.pubsub_topic_ids

  project = var.project_id
  topic   = each.value
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.control_api.email}"
}

# =============================================================
# intelligence-worker permissions
# - Cloud SQL Client (connect via proxy)
# - Pub/Sub Subscriber (consume domain events)
# - Pub/Sub Publisher on dead-letter topics (Pub/Sub needs this
#   so the service can forward undeliverable messages)
# - GCS Object Viewer on source documents bucket
# =============================================================
resource "google_project_iam_member" "intelligence_worker_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.intelligence_worker.email}"
}

resource "google_pubsub_subscription_iam_member" "intelligence_worker_subscriber" {
  for_each = var.pubsub_subscription_ids

  project      = var.project_id
  subscription = each.value
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.intelligence_worker.email}"
}

resource "google_pubsub_topic_iam_member" "intelligence_worker_dlq_publisher" {
  for_each = var.pubsub_dead_letter_topic_ids

  project = var.project_id
  topic   = each.value
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.intelligence_worker.email}"
}

resource "google_storage_bucket_iam_member" "intelligence_worker_source_docs_reader" {
  count = var.source_documents_bucket_name != "" ? 1 : 0

  bucket = var.source_documents_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.intelligence_worker.email}"
}

# =============================================================
# llm-gateway permissions
# - Cloud SQL Client (read-only access via application layer)
# =============================================================
resource "google_project_iam_member" "llm_gateway_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.llm_gateway.email}"
}

# =============================================================
# web-deploy permissions
# - GCS Object Viewer on exports bucket (serve reports)
# =============================================================
resource "google_storage_bucket_iam_member" "web_deploy_exports_reader" {
  count = var.exports_bucket_name != "" ? 1 : 0

  bucket = var.exports_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.web_deploy.email}"
}
