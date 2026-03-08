# -----------------------------------------------------
# Dead Letter Topics (one per main topic)
# -----------------------------------------------------
resource "google_pubsub_topic" "dead_letter" {
  for_each = toset(var.topic_names)

  project = var.project_id
  name    = "bd-${var.environment}-${each.key}-dlq"

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
