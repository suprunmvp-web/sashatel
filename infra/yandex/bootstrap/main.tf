terraform {
  required_version = "= 1.11.4"
  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "= 0.244.0"
    }
  }
}
provider "yandex" {
  cloud_id  = var.cloud_id
  folder_id = var.folder_id
}
variable "cloud_id" { type = string }
variable "folder_id" { type = string }

# Bootstrap uses LOCAL state on an encrypted operator volume until remote migration.
variable "state_bucket" { type = string }
resource "yandex_kms_symmetric_key" "state" {
  name              = "sashatel-tfstate"
  default_algorithm = "AES_256"
  rotation_period   = "8760h"
  lifecycle { prevent_destroy = true }
}
resource "yandex_storage_bucket" "state" {
  bucket        = var.state_bucket
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
        kms_master_key_id = yandex_kms_symmetric_key.state.id
        sse_algorithm     = "aws:kms"
      }
    }
  }
  lifecycle { prevent_destroy = true }
}
output "state_bucket" { value = yandex_storage_bucket.state.bucket }
