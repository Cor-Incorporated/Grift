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
