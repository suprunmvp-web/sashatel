terraform {
  backend "s3" {}
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
