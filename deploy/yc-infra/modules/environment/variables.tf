variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Use staging or production."
  }
}
variable "folder_id" {
  type = string
  nullable = false
  validation {
    condition = length(trimspace(var.folder_id)) > 5
    error_message = "The real Yandex Cloud catalog ID is required."
  }
}
variable "zone" { type = string }
variable "subnets" {
  type = map(object({
    zone = string
    cidr = string
  }))
}
variable "ssh_public_key" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^ssh-(ed25519|rsa) ", var.ssh_public_key))
    error_message = "Supply a public SSH key only."
  }
}
variable "ssh_cidrs" {
  type = list(string)
  validation {
    condition     = length(var.ssh_cidrs) > 0 && alltrue([for cidr in var.ssh_cidrs : can(cidrhost(cidr, 0)) && cidr != "0.0.0.0/0"])
    error_message = "Explicit non-public SSH admin CIDRs required."
  }
}
variable "vm_image_id" {
  type = string
  validation {
    condition = length(trimspace(var.vm_image_id)) > 5
    error_message = "Pin a reviewed VM image ID."
  }
}
variable "vm_cores" { type = number }
variable "vm_memory_gb" { type = number }
variable "db_resource_preset_id" { type = string }
variable "db_disk_size_gb" { type = number }
variable "db_hosts" {
  type = map(string)
  description = "Map host name to subnet key; production must have at least two hosts."
}

# Reuse a known Yandex Cloud VPC and subnet(s) without creating a duplicate.
# These are IDs, not names. Both inputs are required together.
variable "existing_network_id" {
  type = string
  default = null
  nullable = true
  validation {
    condition = var.existing_network_id == null ? true : length(trimspace(var.existing_network_id)) > 5
    error_message = "Existing VPC must be specified by its real network ID."
  }
}
variable "existing_subnet_ids" {
  type = map(string)
  default = {}
  validation {
    condition = alltrue([for id in values(var.existing_subnet_ids) : length(trimspace(id)) > 5])
    error_message = "Use real subnet IDs, not subnet names."
  }
}

# Pull-only identity attached to staging VM; no static registry password.
variable "vm_service_account_id" {
  type = string
  default = null
  nullable = true
}
