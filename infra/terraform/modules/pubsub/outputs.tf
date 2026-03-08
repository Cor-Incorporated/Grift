output "topic_ids" {
  description = "Map of topic name to topic ID"
  value       = { for k, v in google_pubsub_topic.main : k => v.id }
}

output "topic_names" {
  description = "Map of topic key to full topic name"
  value       = { for k, v in google_pubsub_topic.main : k => v.name }
}

output "subscription_ids" {
  description = "Map of topic name to subscription ID"
  value       = { for k, v in google_pubsub_subscription.main : k => v.id }
}

output "dead_letter_topic_ids" {
  description = "Map of topic name to dead letter topic ID"
  value       = { for k, v in google_pubsub_topic.dead_letter : k => v.id }
}
