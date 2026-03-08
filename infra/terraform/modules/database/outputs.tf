output "instance_name" {
  description = "The name of the Cloud SQL instance"
  value       = google_sql_database_instance.main.name
}

output "connection_name" {
  description = "The connection name for Cloud SQL Proxy (project:region:instance)"
  value       = google_sql_database_instance.main.connection_name
}

output "private_ip" {
  description = "The private IP address of the Cloud SQL instance"
  value       = google_sql_database_instance.main.private_ip_address
}

output "database_name" {
  description = "The name of the default database"
  value       = google_sql_database.default.name
}

output "database_user" {
  description = "The application database username"
  value       = google_sql_user.app.name
}

output "database_password" {
  description = "The application database password"
  value       = random_password.db_password.result
  sensitive   = true
}

output "instance_self_link" {
  description = "The self link of the Cloud SQL instance"
  value       = google_sql_database_instance.main.self_link
}
