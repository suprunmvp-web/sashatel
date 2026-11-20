terraform {
  required_version = ">= 1.6.0"
  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = ">= 0.160.0"
    }
  }
}

provider "yandex" {
  folder_id = var.folder_id
  zone      = var.primary_zone
}

variable "folder_id" { type = string }
variable "primary_zone" {
  type    = string
  default = "ru-central1-a"
}
variable "secondary_zone" {
  type    = string
  default = "ru-central1-d"
}
variable "vm_image_id" { type = string }
variable "ssh_public_key" { type = string }
variable "ssh_cidrs" { type = list(string) }
variable "db_resource_preset_id" {
  type    = string
  default = "s2.medium"
}

module "environment" {
  source                = "../../modules/environment"
  environment           = "production"
  folder_id             = var.folder_id
  zone                  = var.primary_zone
  vm_image_id           = var.vm_image_id
  ssh_public_key        = var.ssh_public_key
  ssh_cidrs             = var.ssh_cidrs
  vm_cores              = 2
  vm_memory_gb          = 4
  db_resource_preset_id = var.db_resource_preset_id
  db_disk_size_gb       = 32
  subnets = {
    (var.primary_zone)   = { zone = var.primary_zone, cidr = "10.78.0.0/24" }
    (var.secondary_zone) = { zone = var.secondary_zone, cidr = "10.78.1.0/24" }
  }
  db_hosts = {
    "pg-1" = var.primary_zone
    "pg-2" = var.secondary_zone
  }
}

output "api_vm_id" { value = module.environment.api_vm_id }
output "postgres_cluster_id" { value = module.environment.postgres_cluster_id }
output "api_private_ip" { value = module.environment.api_private_ip }
