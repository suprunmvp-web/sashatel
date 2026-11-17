locals {
  prefix = "sashatel-${var.environment}"
  zones  = sort(keys(var.zones))
}
resource "yandex_vpc_network" "main" { name = local.prefix }
resource "yandex_vpc_gateway" "egress" {
  name = "${local.prefix}-egress"
  shared_egress_gateway {}
}
resource "yandex_vpc_route_table" "egress" {
  network_id = yandex_vpc_network.main.id
  static_route {
    destination_prefix = "0.0.0.0/0"
    gateway_id         = yandex_vpc_gateway.egress.id
  }
}
resource "yandex_vpc_subnet" "private" {
  for_each       = var.zones
  name           = "${local.prefix}-${each.key}"
  zone           = each.key
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = [each.value]
  route_table_id = yandex_vpc_route_table.egress.id
}
resource "yandex_vpc_security_group" "hosts" {
  name       = "${local.prefix}-hosts"
  network_id = yandex_vpc_network.main.id
  ingress {
    protocol       = "TCP"
    port           = 22
    v4_cidr_blocks = var.admin_cidrs
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
    port           = 53
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "yandex_vpc_security_group" "alb" {
  name       = "${local.prefix}-alb"
  network_id = yandex_vpc_network.main.id
  ingress {
    protocol       = "TCP"
    port           = 443
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    protocol          = "TCP"
    port              = 30080
    predefined_target = "loadbalancer_healthchecks"
  }
  egress {
    protocol       = "TCP"
    port           = 8080
    v4_cidr_blocks = values(var.zones)
  }
}
resource "yandex_vpc_security_group" "api" {
  name       = "${local.prefix}-api"
  network_id = yandex_vpc_network.main.id
  ingress {
    protocol          = "TCP"
    port              = 8080
    security_group_id = yandex_vpc_security_group.alb.id
  }
}
resource "yandex_vpc_security_group" "db_client" {
  name       = "${local.prefix}-db-client"
  network_id = yandex_vpc_network.main.id
  egress {
    protocol       = "TCP"
    port           = 6432
    v4_cidr_blocks = values(var.zones)
  }
}
resource "yandex_vpc_security_group" "db" {
  name       = "${local.prefix}-db"
  network_id = yandex_vpc_network.main.id
  ingress {
    protocol          = "TCP"
    port              = 6432
    security_group_id = yandex_vpc_security_group.db_client.id
  }
  ingress {
    protocol          = "ANY"
    from_port         = 0
    to_port           = 65535
    predefined_target = "self_security_group"
  }
}
