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
