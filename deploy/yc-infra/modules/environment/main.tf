locals {
  name = "sashatel-${var.environment}"
  network_id = var.existing_network_id == null ? yandex_vpc_network.environment[0].id : var.existing_network_id
  subnet_ids = var.existing_network_id == null ? { for zone, subnet in yandex_vpc_subnet.environment : zone => subnet.id } : var.existing_subnet_ids
  labels = {
    project     = "sashatel"
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "yandex_vpc_network" "environment" {
  count     = var.existing_network_id == null ? 1 : 0
  folder_id = var.folder_id
  name      = "${local.name}-vpc"
  labels    = local.labels
}

resource "yandex_vpc_subnet" "environment" {
  for_each       = var.existing_network_id == null ? var.subnets : {}
  folder_id      = var.folder_id
  name           = "${local.name}-${each.key}"
  network_id     = local.network_id
  zone           = each.value.zone
  v4_cidr_blocks = [each.value.cidr]
}

resource "yandex_vpc_security_group" "api" {
  folder_id  = var.folder_id
  name       = "${local.name}-api"
  network_id = local.network_id
  labels     = local.labels

  dynamic "ingress" {
    for_each = var.ssh_cidrs
    content {
      protocol       = "TCP"
      port           = 22
      v4_cidr_blocks = [ingress.value]
      description    = "Restricted SSH administration only"
    }
  }
  egress {
    protocol       = "ANY"
    from_port      = 0
    to_port        = 65535
    v4_cidr_blocks = ["0.0.0.0/0"]
    description    = "Package downloads and private database egress"
  }
}

resource "yandex_vpc_security_group" "postgres" {
  folder_id  = var.folder_id
  name       = "${local.name}-pg"
  network_id = local.network_id
  labels     = local.labels

  ingress {
    protocol          = "TCP"
    port              = 6432
    security_group_id = yandex_vpc_security_group.api.id
    description       = "Managed PostgreSQL from API security group only"
  }
  # Managed DB intra-cluster and provider operational traffic may require
  # additional provider-defined rules for production HA; validate before apply.
  ingress {
    protocol          = "ANY"
    from_port         = 0
    to_port           = 65535
    predefined_target = "self_security_group"
    description       = "Only cluster members may exchange replication traffic"
  }
  egress {
    protocol       = "ANY"
    from_port      = 0
    to_port        = 65535
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "yandex_compute_instance" "api" {
  folder_id   = var.folder_id
  name        = "${local.name}-api-1"
  hostname    = "${local.name}-api-1"
  platform_id = "standard-v3"
  zone        = var.zone
  labels      = local.labels

  resources {
    cores  = var.vm_cores
    memory = var.vm_memory_gb
  }
  boot_disk {
    initialize_params {
      image_id = var.vm_image_id
      size     = 30
      type     = "network-ssd"
    }
  }
  network_interface {
    subnet_id          = local.subnet_ids[var.zone]
    nat                = true
    security_group_ids = [yandex_vpc_security_group.api.id]
  }
  metadata = {
    ssh-keys = "ubuntu:${var.ssh_public_key}"
  }
  scheduling_policy {
    preemptible = false
  }

  lifecycle {
    precondition {
      condition = contains(keys(local.subnet_ids), var.zone)
      error_message = "VM zone must have a configured subnet."
    }
    prevent_destroy = true
  }
}

resource "yandex_mdb_postgresql_cluster_v2" "db" {
  folder_id         = var.folder_id
  name              = "${local.name}-postgresql-17"
  environment       = "PRODUCTION"
  network_id        = local.network_id
  security_group_ids = [yandex_vpc_security_group.postgres.id]
  deletion_protection = true
  labels              = local.labels

  config {
    version = 17
    resources {
      resource_preset_id = var.db_resource_preset_id
      disk_type_id       = "network-ssd"
      disk_size          = var.db_disk_size_gb
    }
  }

  hosts = {
    for host_name, subnet_key in var.db_hosts : host_name => {
      zone             = var.subnets[subnet_key].zone
      subnet_id        = local.subnet_ids[subnet_key]
      assign_public_ip = false
    }
  }

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.environment != "production" || length(var.db_hosts) >= 2
      error_message = "Production PostgreSQL requires at least two hosts."
    }
  }
}
