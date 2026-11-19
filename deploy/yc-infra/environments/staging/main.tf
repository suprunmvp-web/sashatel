terraform {
  required_version = ">= 1.6.0"
  required_providers {
    yandex = {
      source = "yandex-cloud/yandex"
      version = ">= 0.160.0"
    }
  }
}

provider "yandex" {
  folder_id = var.folder_id
  zone      = var.zone
}

variable "folder_id" { type = string }
variable "zone" { type = string; default = "ru-central1-a" }
variable "vm_image_id" { type = string }
variable "ssh_public_key" { type = string }
variable "ssh_cidrs" { type = list(string) }
variable "db_resource_preset_id" { type = string; default = "s2.micro" }

module "environment" {
  source                = "../../modules/environment"
  environment           = "staging"
  folder_id             = var.folder_id
  zone                  = var.zone
  vm_image_id           = var.vm_image_id
  ssh_public_key        = var.ssh_public_key
  ssh_cidrs             = var.ssh_cidrs
  vm_cores              = 2
  vm_memory_gb          = 4
  db_resource_preset_id = var.db_resource_preset_id
  db_disk_size_gb       = 16
  subnets = {
    (var.zone) = { zone = var.zone, cidr = "10.77.0.0/24" }
  }
  db_hosts = { "pg-1" = var.zone }
}

output "api_vm_id" { value = module.environment.api_vm_id }
output "postgres_cluster_id" { value = module.environment.postgres_cluster_id }
output "api_private_ip" { value = module.environment.api_private_ip }
