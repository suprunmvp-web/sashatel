variable "enable_admin_bastion" {
  description = "Enable only after approval if no existing private administrative route exists."
  type        = bool
  default     = false
}
variable "admin_public_cidrs" {
  type    = list(string)
  default = []
  validation {
    condition     = alltrue([for c in var.admin_public_cidrs : can(cidrhost(c, 0)) && can(regex("^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+/32$", c))])
    error_message = "Bastion accepts exact IPv4 /32 administrative sources only."
  }
}
resource "yandex_vpc_security_group" "bastion" {
  name       = "${local.prefix}-bastion"
  network_id = yandex_vpc_network.main.id
  dynamic "ingress" {
    for_each = var.admin_public_cidrs
    content {
      protocol       = "TCP"
      port           = 22
      v4_cidr_blocks = [ingress.value]
    }
  }
  egress {
    protocol       = "TCP"
    port           = 443
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    protocol       = "UDP"
    port           = 53
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    protocol       = "TCP"
    port           = 22
    v4_cidr_blocks = values(var.zones)
  }
}
resource "yandex_vpc_address" "bastion" {
  count = var.enable_admin_bastion ? 1 : 0
  name  = "${local.prefix}-bastion"
  external_ipv4_address { zone_id = local.zones[0] }
}
resource "yandex_compute_instance" "bastion" {
  count       = var.enable_admin_bastion ? 1 : 0
  name        = "${local.prefix}-bastion"
  zone        = local.zones[0]
  platform_id = "standard-v3"
  resources {
    cores         = 2
    memory        = 2
    core_fraction = 100
  }
  boot_disk {
    initialize_params {
      image_id = var.image_id
      type     = "network-ssd-io-m3"
      size     = 20
    }
  }
  network_interface {
    subnet_id          = yandex_vpc_subnet.private[local.zones[0]].id
    nat                = true
    nat_ip_address     = yandex_vpc_address.bastion[0].external_ipv4_address[0].address
    security_group_ids = [yandex_vpc_security_group.bastion.id]
  }
  metadata = {
    user-data = <<-CLOUD
      #cloud-config
      users:
        - name: sashatel-admin
          groups: [sudo]
          sudo: ["ALL=(ALL) NOPASSWD:ALL"]
          shell: /bin/bash
          lock_passwd: true
          ssh_authorized_keys:
            - ${var.ssh_public_key}
      disable_root: true
      ssh_pwauth: false
    CLOUD
  }
  lifecycle {
    precondition {
      condition     = length(var.admin_public_cidrs) > 0
      error_message = "Bastion requires an approved public source /32."
    }
  }
}
output "bastion_ip" {
  value = var.enable_admin_bastion ? yandex_vpc_address.bastion[0].external_ipv4_address[0].address : null
}
