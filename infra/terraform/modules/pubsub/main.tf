# -----------------------------------------------------
# Project data (needed for Pub/Sub service agent email)
# -----------------------------------------------------
data "google_project" "project" {
  project_id = var.project_id
}

locals {
  # Pub/Sub service agent must have publisher on DLQ topics and subscriber on
  # main subscriptions for dead_letter_policy forwarding to work.
  # See: https://cloud.google.com/pubsub/docs/handling-failures#dead_letter_topic_iam
  pubsub_service_agent = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# -----------------------------------------------------
# Dead Letter Topics (one per main topic)
# -----------------------------------------------------
resource "google_pubsub_topic" "dead_letter" {
  for_each = toset(var.topic_names)

  project = var.project_id
  name    = "${google_pubsub_topic.main[each.key].name}-dlq"

  message_retention_duration = var.message_retention_duration

  labels = local.labels
}

# -----------------------------------------------------
# Dead Letter Subscriptions (for monitoring/replay)
# -----------------------------------------------------
resource "google_pubsub_subscription" "dead_letter" {
  for_each = toset(var.topic_names)

  project = var.project_id
  name    = "bd-${var.environment}-${each.key}-dlq-sub"
  topic   = google_pubsub_topic.dead_letter[each.key].id

  ack_deadline_seconds       = var.ack_deadline_seconds
  message_retention_duration = "604800s" # 7 days for dead letters

  labels = local.labels
}

# -----------------------------------------------------
# DLQ Monitoring Alert (num_undelivered_messages > 0)
# -----------------------------------------------------
resource "google_monitoring_alert_policy" "dead_letter_non_empty" {
  for_each = toset(var.topic_names)

  project      = var.project_id
  display_name = "bd-${var.environment}-${each.key}-dlq-non-empty"
  combiner     = "OR"

  conditions {
    display_name = "DLQ undelivered messages > 0 (${each.key})"

    condition_threshold {
      filter = join(
        " AND ",
        [
          "resource.type = \"pubsub_subscription\"",
          "metric.type = \"pubsub.googleapis.com/subscription/num_undelivered_messages\"",
          "resource.label.subscription_id = \"${google_pubsub_subscription.dead_letter[each.key].name}\""
        ]
      )

      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_NONE"
      }
    }
  }

  documentation {
    content = "Dead Letter Queue has pending messages. Investigate and run replay CLI if safe."
  }

  enabled = var.enable_dlq_alerts

  notification_channels = var.notification_channel_ids

  user_labels = local.labels
}

# -----------------------------------------------------
# Pub/Sub Service Agent IAM — DLQ forwarding
# Without these bindings, dead_letter_policy silently drops messages
# instead of forwarding them to the DLQ topic.
# -----------------------------------------------------

# Allow Pub/Sub agent to publish failed messages to DLQ topics
resource "google_pubsub_topic_iam_member" "pubsub_agent_dlq_publisher" {
  for_each = toset(var.topic_names)

  project = var.project_id
  topic   = google_pubsub_topic.dead_letter[each.key].id
  role    = "roles/pubsub.publisher"
  member  = local.pubsub_service_agent
}

# Allow Pub/Sub agent to pull from main subscriptions for forwarding
resource "google_pubsub_subscription_iam_member" "pubsub_agent_subscriber" {
  for_each = toset(var.topic_names)

  project      = var.project_id
  subscription = google_pubsub_subscription.main[each.key].id
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_service_agent
}

# -----------------------------------------------------
# Main Topics
# -----------------------------------------------------
resource "google_pubsub_topic" "main" {
  for_each = toset(var.topic_names)

  project = var.project_id
  name    = "bd-${var.environment}-${each.key}"

  message_retention_duration = var.message_retention_duration

  labels = local.labels
}

# -----------------------------------------------------
# Main Subscriptions (with retry + dead letter)
# -----------------------------------------------------
resource "google_pubsub_subscription" "main" {
  for_each = toset(var.topic_names)

  project = var.project_id
  name    = "bd-${var.environment}-${each.key}-sub"
  topic   = google_pubsub_topic.main[each.key].id

  ack_deadline_seconds       = var.ack_deadline_seconds
  message_retention_duration = var.message_retention_duration

  retry_policy {
    minimum_backoff = var.minimum_backoff
    maximum_backoff = var.maximum_backoff
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter[each.key].id
    max_delivery_attempts = var.max_delivery_attempts
  }

  labels = local.labels
}
