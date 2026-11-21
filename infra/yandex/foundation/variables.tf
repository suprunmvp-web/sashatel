variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Separate folder and state for staging and production."
  }
}
variable "zones" {
  description = "One confirmed AZ is sufficient for staging; production requires three independent AZs."
  type        = map(string)
  validation {
    condition     = contains(var.environment == "production" ? [3] : [1, 2, 3], length(var.zones)) && length(distinct(values(var.zones))) == length(var.zones) && alltrue([for c in values(var.zones) : can(cidrhost(c, 1)) && can(regex("^10[.][0-9]+[.][0-9]+[.]0/24$", c))])
    error_message = "Supply confirmed zones and distinct private CIDRs; production requires three zones."
  }
}
variable "image_id" {
  description = "Immutable reviewed Ubuntu 24.04 image ID. Resolve through authenticated inventory."
  type        = string
}
variable "ssh_public_key" {
  type = string
  validation {
    condition     = can(regex("^ssh-ed25519 [A-Za-z0-9+/=]+( [A-Za-z0-9_.@-]+)?$", var.ssh_public_key))
    error_message = "Supply only an ed25519 public key."
  }
}
variable "admin_cidrs" {
  description = "Private admin addresses routed by a separately approved VPN/bastion path."
  type        = list(string)
  validation {
    condition     = (length(var.admin_cidrs) > 0 || var.enable_admin_bastion) && alltrue([for c in var.admin_cidrs : can(cidrhost(c, 0)) && can(regex("^10[.][0-9]+[.][0-9]+[.][0-9]+/32$", c))])
    error_message = "Explicit restricted administrative sources required."
  }
}
variable "bucket_prefix" { type = string }
variable "postgres_preset" {
  type    = string
  default = "s3-c2-m8"
}
variable "enable_edge" {
  type    = bool
  default = false
}
variable "certificate_id" {
  type    = string
  default = ""
}
