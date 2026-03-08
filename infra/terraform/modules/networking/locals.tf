locals {
  vpc_name = var.vpc_name != "" ? var.vpc_name : "bd-${var.environment}-vpc"

  default_labels = {
    environment = var.environment
    project     = "benevolent-director"
    managed_by  = "terraform"
  }

  labels = merge(local.default_labels, var.labels)
}
