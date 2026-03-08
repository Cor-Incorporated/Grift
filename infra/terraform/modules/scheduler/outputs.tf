output "scheduler_job_id" {
  description = "The ID of the Cloud Scheduler job"
  value       = google_cloud_scheduler_job.crawl.id
}

output "scheduler_job_name" {
  description = "The full resource name of the Cloud Scheduler job"
  value       = google_cloud_scheduler_job.crawl.name
}
