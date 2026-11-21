locals {
  # Initial bootstrap creates app/jobs only. Telephony has its own later network gate.
  pools = { app = var.environment == "production" ? 2 : 1, jobs = var.environment == "production" ? 2 : 0 }
  nodes = merge([for pool, count in local.pools : {
    for index in range(count) : "${pool}-${index}" => {
      pool = pool
      zone = local.zones[index % length(local.zones)]
    }
  }]...)
}
resource "yandex_iam_service_account" "process" {
  for_each = local.pools
  name     = "${local.prefix}-${each.key}"
}
resource "yandex_compute_instance" "node" {
  for_each           = local.nodes
  name               = "${local.prefix}-${each.key}"
  zone               = each.value.zone
  platform_id        = "standard-v3"
  service_account_id = yandex_iam_service_account.process[each.value.pool].id
  resources {
    cores         = 2
    memory        = 4
    core_fraction = 100
  }
  boot_disk {
    initialize_params {
      image_id = var.image_id
      type     = "network-ssd-io-m3"
      size     = 30
    }
  }
  network_interface {
    subnet_id = yandex_vpc_subnet.private[each.value.zone].id
    nat       = false
    security_group_ids = concat(
      [yandex_vpc_security_group.hosts.id, yandex_vpc_security_group.db_client.id],
      each.value.pool == "app" ? [yandex_vpc_security_group.api.id] : []
    )
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
}
output "node_private_ips" {
  value = { for k, n in yandex_compute_instance.node : k => n.network_interface[0].ip_address }
}
