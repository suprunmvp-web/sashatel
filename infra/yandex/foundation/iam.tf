resource "yandex_lockbox_secret_iam_binding" "runtime" {
  secret_id = yandex_lockbox_secret.service["db-runtime"].id
  role      = "lockbox.payloadViewer"
  members   = [for s in yandex_iam_service_account.process : "serviceAccount:${s.id}"]
}
resource "yandex_lockbox_secret_iam_binding" "jobs" {
  for_each  = toset(["email", "dadata"])
  secret_id = yandex_lockbox_secret.service[each.key].id
  role      = "lockbox.payloadViewer"
  members   = ["serviceAccount:${yandex_iam_service_account.process["jobs"].id}"]
}
resource "yandex_storage_bucket_iam_binding" "recordings_read" {
  bucket  = yandex_storage_bucket.private["recordings"].id
  role    = "storage.viewer"
  members = ["serviceAccount:${yandex_iam_service_account.process["app"].id}"]
}
resource "yandex_storage_bucket_iam_binding" "jobs" {
  for_each = toset(["audit", "exports"])
  bucket   = yandex_storage_bucket.private[each.key].id
  role     = "storage.uploader"
  members  = ["serviceAccount:${yandex_iam_service_account.process["jobs"].id}"]
}
resource "yandex_kms_symmetric_key_iam_binding" "runtime" {
  symmetric_key_id = yandex_kms_symmetric_key.data.id
  role             = "kms.keys.encrypterDecrypter"
  members          = [for s in yandex_iam_service_account.process : "serviceAccount:${s.id}"]
}
