output "network_id" {
  description = "The ID of the VPC network"
  value       = google_compute_network.vpc.id
}

output "network_name" {
  description = "The name of the VPC network"
  value       = google_compute_network.vpc.name
}

output "network_self_link" {
  description = "The self link of the VPC network"
  value       = google_compute_network.vpc.self_link
}

output "public_subnet_id" {
  description = "The ID of the public subnet"
  value       = google_compute_subnetwork.public.id
}

output "public_subnet_name" {
  description = "The name of the public subnet"
  value       = google_compute_subnetwork.public.name
}

output "private_subnet_id" {
  description = "The ID of the private subnet"
  value       = google_compute_subnetwork.private.id
}

output "private_subnet_name" {
  description = "The name of the private subnet"
  value       = google_compute_subnetwork.private.name
}

output "router_name" {
  description = "The name of the Cloud Router"
  value       = google_compute_router.router.name
}

output "nat_name" {
  description = "The name of the Cloud NAT"
  value       = google_compute_router_nat.nat.name
}

output "private_services_connection" {
  description = "The private services networking connection (for Cloud SQL)"
  value       = google_service_networking_connection.private_services
}
