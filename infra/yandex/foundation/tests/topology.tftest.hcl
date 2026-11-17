mock_provider "yandex" {}
variables {
  cloud_id       = "offline-fixture"
  folder_id      = "offline-fixture"
  bucket_prefix  = "offline-sashatel"
  image_id       = "offline-reviewed-image"
  ssh_public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly fixture"
  admin_cidrs    = ["10.254.0.2/32"]
  zones = {
    ru-central1-a = "10.60.1.0/24"
    ru-central1-b = "10.60.2.0/24"
    ru-central1-d = "10.60.3.0/24"
  }
}
run "staging_private" {
  command = plan
  variables { environment = "staging" }
  assert {
    condition     = length(yandex_compute_instance.node) == 2 && length(yandex_mdb_postgresql_cluster.main.host) == 1
    error_message = "Staging must create exactly app/jobs and one DB host."
  }
  assert {
    condition     = alltrue([for n in yandex_compute_instance.node : !n.network_interface[0].nat])
    error_message = "Bootstrap VM addresses must remain private."
  }
  assert {
    condition     = alltrue([for h in yandex_mdb_postgresql_cluster.main.host : !h.assign_public_ip])
    error_message = "No public database host."
  }
  assert {
    condition     = length(yandex_alb_load_balancer.app) == 0
    error_message = "Public edge must default off."
  }
}
run "production_ha" {
  command = plan
  variables { environment = "production" }
  assert {
    condition     = length(yandex_compute_instance.node) == 4 && length(yandex_mdb_postgresql_cluster.main.host) == 3
    error_message = "Production needs paired app/jobs and three DB hosts."
  }
  assert {
    condition     = alltrue([for b in yandex_storage_bucket.private : !one(b.anonymous_access_flags).read && !one(b.anonymous_access_flags).list && b.versioning[0].enabled])
    error_message = "Buckets must be private and versioned."
  }
}
run "edge_needs_certificate" {
  command = plan
  variables {
    environment = "staging"
    enable_edge = true
  }
  expect_failures = [yandex_alb_load_balancer.app]
}

run "reject_public_admin" {
  command = plan
  variables {
    environment = "staging"
    admin_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [var.admin_cidrs]
}
run "reject_overlapping_subnets" {
  command = plan
  variables {
    environment = "staging"
    zones = {
      ru-central1-a = "10.60.1.0/24"
      ru-central1-b = "10.60.1.0/24"
      ru-central1-d = "10.60.3.0/24"
    }
  }
  expect_failures = [var.zones]
}
