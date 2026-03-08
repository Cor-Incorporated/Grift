# -----------------------------------------------------
# VPC Network
# -----------------------------------------------------
resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = local.vpc_name
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

# -----------------------------------------------------
# Public Subnet (Load Balancers)
# -----------------------------------------------------
resource "google_compute_subnetwork" "public" {
  project                  = var.project_id
  name                     = "bd-${var.environment}-public"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = var.public_subnet_cidr
  private_ip_google_access = true
}

# -----------------------------------------------------
# Private Subnet (Cloud SQL, GKE, Cloud Run)
# -----------------------------------------------------
resource "google_compute_subnetwork" "private" {
  project                  = var.project_id
  name                     = "bd-${var.environment}-private"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = var.private_subnet_cidr
  private_ip_google_access = true
}

# -----------------------------------------------------
# Private Services Access (for Cloud SQL VPC peering)
# -----------------------------------------------------
resource "google_compute_global_address" "private_services" {
  project       = var.project_id
  name          = "bd-${var.environment}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = split("/", var.private_services_cidr)[1]
  address       = split("/", var.private_services_cidr)[0]
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

# -----------------------------------------------------
# Cloud Router (for Cloud NAT)
# -----------------------------------------------------
resource "google_compute_router" "router" {
  project = var.project_id
  name    = "bd-${var.environment}-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

# -----------------------------------------------------
# Cloud NAT (allows private subnet egress)
# -----------------------------------------------------
resource "google_compute_router_nat" "nat" {
  project                            = var.project_id
  name                               = "bd-${var.environment}-nat"
  router                             = google_compute_router.router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.private.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# -----------------------------------------------------
# Firewall: deny all ingress by default
# -----------------------------------------------------
resource "google_compute_firewall" "deny_all_ingress" {
  project   = var.project_id
  name      = "bd-${var.environment}-deny-all-ingress"
  network   = google_compute_network.vpc.id
  direction = "INGRESS"
  priority  = 65534

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
}

# -----------------------------------------------------
# Firewall: allow internal communication
# -----------------------------------------------------
resource "google_compute_firewall" "allow_internal" {
  project   = var.project_id
  name      = "bd-${var.environment}-allow-internal"
  network   = google_compute_network.vpc.id
  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
  }

  allow {
    protocol = "udp"
  }

  allow {
    protocol = "icmp"
  }

  source_ranges = [
    var.public_subnet_cidr,
    var.private_subnet_cidr,
  ]
}

# -----------------------------------------------------
# Firewall: allow health checks from GCP LB ranges
# -----------------------------------------------------
resource "google_compute_firewall" "allow_health_checks" {
  project   = var.project_id
  name      = "bd-${var.environment}-allow-health-checks"
  network   = google_compute_network.vpc.id
  direction = "INGRESS"
  priority  = 900

  allow {
    protocol = "tcp"
    ports    = ["80", "443", "8080"]
  }

  # Google Cloud health check IP ranges
  source_ranges = [
    "35.191.0.0/16",
    "130.211.0.0/22",
  ]
}
