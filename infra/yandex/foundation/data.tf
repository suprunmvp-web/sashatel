resource "yandex_mdb_postgresql_cluster" "main" {
  name                = local.prefix
  environment         = "PRODUCTION"
  network_id          = yandex_vpc_network.main.id
  security_group_ids  = [yandex_vpc_security_group.db.id]
  deletion_protection = true
  config {
    version                   = 17
    backup_retain_period_days = 30
    resources {
      resource_preset_id = var.postgres_preset
      disk_type_id       = "network-ssd"
      disk_size          = 100
    }
    pooler_config { pooling_mode = "TRANSACTION" }
    backup_window_start {
      hours   = 22
      minutes = 0
    }
    access { web_sql = false }
  }
  dynamic "host" {
    for_each = var.environment == "production" ? local.zones : [local.zones[0]]
    content {
      zone             = host.value
      subnet_id        = yandex_vpc_subnet.private[host.value].id
      assign_public_ip = false
    }
  }
  maintenance_window {
    type = "WEEKLY"
    day  = "SUN"
    hour = 2
  }
  lifecycle { prevent_destroy = true }
}
resource "yandex_kms_symmetric_key" "data" {
  name              = "${local.prefix}-data"
  default_algorithm = "AES_256"
  rotation_period   = "8760h"
  lifecycle { prevent_destroy = true }
}
resource "yandex_storage_bucket" "private" {
  for_each      = toset(["recordings", "audit", "exports"])
  bucket        = "${var.bucket_prefix}-${var.environment}-${each.key}"
  folder_id     = var.folder_id
  force_destroy = false
  versioning { enabled = true }
  anonymous_access_flags {
    read        = false
    list        = false
    config_read = false
  }
  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        kms_master_key_id = yandex_kms_symmetric_key.data.id
        sse_algorithm     = "aws:kms"
      }
    }
  }
  lifecycle { prevent_destroy = true }
}
# No passwords, secret payload versions or static access keys in Terraform state.
resource "yandex_lockbox_secret" "service" {
  for_each            = toset(["db-runtime", "db-migration", "email", "dadata"])
  name                = "${local.prefix}-${each.key}"
  kms_key_id          = yandex_kms_symmetric_key.data.id
  deletion_protection = true
}
output "database_hosts" { value = yandex_mdb_postgresql_cluster.main.host[*].fqdn }
