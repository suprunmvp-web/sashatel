terraform {
  # S3-compatible remote state in a private, versioned Yandex Object Storage bucket.
  # All credentials come from protected GitHub environment secrets.
  backend "s3" {
    bucket = "sashatel-staging-tfstate-677"
    key    = "terraform/staging/terraform.tfstate"
    region = "ru-central1"
    endpoints = {
      s3 = "https://storage.yandexcloud.net"
    }
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    # Object Storage supports conditional PutObject; lock is additionally
    # serialized by GitHub environment protection and workflow concurrency.
    use_lockfile                = true
  }
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
variable "existing_network_id" { type = string }
variable "existing_subnet_id" { type = string }
variable "vm_service_account_id" { type = string }
variable "zone" {
  type    = string
  default = "ru-central1-a"
}
variable "vm_image_id" { type = string }
variable "ssh_public_key" { type = string }
variable "ssh_cidrs" { type = list(string) }
variable "db_resource_preset_id" {
  type    = string
  default = "s2.micro"
}

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
  vm_service_account_id = var.vm_service_account_id
  existing_network_id = var.existing_network_id
  existing_subnet_ids = { (var.zone) = var.existing_subnet_id }
  db_disk_size_gb       = 16
  subnets = {
    (var.zone) = { zone = var.zone, cidr = "10.77.0.0/24" }
  }
  db_hosts = { "pg-1" = var.zone }
}

output "api_vm_id" { value = module.environment.api_vm_id }
output "postgres_cluster_id" { value = module.environment.postgres_cluster_id }
output "api_private_ip" { value = module.environment.api_private_ip }
