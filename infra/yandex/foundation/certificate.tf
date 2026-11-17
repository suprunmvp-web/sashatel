variable "request_staging_certificate" {
  description = "Request only after ownership and existing DNS are verified; DNS writes are a separate reviewed operation."
  type        = bool
  default     = false
  validation {
    condition     = !var.request_staging_certificate || var.environment == "staging"
    error_message = "This release may only request the exact staging certificate."
  }
}
resource "yandex_cm_certificate" "staging" {
  count     = var.request_staging_certificate ? 1 : 0
  name      = "sashatel-staging-https"
  folder_id = var.folder_id
  domains   = ["staging.platform.sashatel.ru"]
  managed { challenge_type = "DNS_CNAME" }
  lifecycle { prevent_destroy = true }
}
output "staging_certificate_request" {
  value = var.request_staging_certificate ? {
    id         = yandex_cm_certificate.staging[0].id
    challenges = yandex_cm_certificate.staging[0].challenges
  } : null
}
