locals {
  instance_name = "bd-${var.environment}-postgres"

  default_labels = {
    environment = var.environment
    project     = "benevolent-director"
    managed_by  = "terraform"
  }

  labels = merge(local.default_labels, var.labels)
}
