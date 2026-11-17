# Pinned Terraform 1.11.4 still supports the documented DynamoDB-compatible lock.
# The Document API table is bootstrapped separately after this reviewed root.
resource "yandex_ydb_database_serverless" "state_lock" {
  name                = "sashatel-state-lock"
  folder_id           = var.folder_id
  location_id         = "ru-central1"
  deletion_protection = true
  serverless_database {
    enable_throttling_rcu_limit = true
    throttling_rcu_limit        = 10
    storage_size_limit          = 1
  }
  lifecycle { prevent_destroy = true }
}
output "lock_document_endpoint" {
  value = yandex_ydb_database_serverless.state_lock.document_api_endpoint
}
