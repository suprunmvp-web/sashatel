resource "yandex_alb_target_group" "app" {
  name = "${local.prefix}-app"
  dynamic "target" {
    for_each = { for k, n in yandex_compute_instance.node : k => n if startswith(k, "app-") }
    content {
      subnet_id  = target.value.network_interface[0].subnet_id
      ip_address = target.value.network_interface[0].ip_address
    }
  }
}
resource "yandex_alb_backend_group" "app" {
  name = "${local.prefix}-app"
  http_backend {
    name             = "web-api"
    port             = 8080
    weight           = 1
    target_group_ids = [yandex_alb_target_group.app.id]
    load_balancing_config { panic_threshold = 0 }
    healthcheck {
      timeout             = "2s"
      interval            = "5s"
      healthy_threshold   = 2
      unhealthy_threshold = 2
      http_healthcheck {
        path              = "/health"
        expected_statuses = [200]
      }
    }
  }
}
resource "yandex_alb_http_router" "app" { name = "${local.prefix}-app" }
resource "yandex_alb_virtual_host" "app" {
  name           = "platform"
  http_router_id = yandex_alb_http_router.app.id
  authority      = [var.environment == "production" ? "platform.sashatel.ru" : "staging.platform.sashatel.ru"]
  route {
    name = "platform"
    http_route {
      http_route_action {
        backend_group_id = yandex_alb_backend_group.app.id
        timeout          = "60s"
        idle_timeout     = "60s"
        upgrade_types    = ["websocket"]
      }
    }
  }
}
resource "yandex_vpc_address" "edge" {
  count = var.enable_edge ? 1 : 0
  name  = "${local.prefix}-edge"
  external_ipv4_address {
    zone_id = local.zones[0]
  }
}
resource "yandex_alb_load_balancer" "app" {
  count              = var.enable_edge ? 1 : 0
  name               = local.prefix
  network_id         = yandex_vpc_network.main.id
  security_group_ids = [yandex_vpc_security_group.alb.id]
  allocation_policy {
    dynamic "location" {
      for_each = slice(local.zones, 0, var.environment == "production" ? 2 : 1)
      content {
        zone_id   = location.value
        subnet_id = yandex_vpc_subnet.private[location.value].id
      }
    }
  }
  auto_scale_policy {
    min_zone_size = 2
    max_size      = var.environment == "production" ? 8 : 4
  }
  listener {
    name = "https"
    endpoint {
      ports = [443]
      address {
        external_ipv4_address {
          address = yandex_vpc_address.edge[0].external_ipv4_address[0].address
        }
      }
    }
    tls {
      default_handler {
        certificate_ids = [var.certificate_id]
        http_handler { http_router_id = yandex_alb_http_router.app.id }
      }
    }
  }
  lifecycle {
    precondition {
      condition     = var.certificate_id != ""
      error_message = "Edge requires a verified Certificate Manager certificate ID."
    }
  }
}
