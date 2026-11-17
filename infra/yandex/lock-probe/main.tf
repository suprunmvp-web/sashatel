terraform {
  required_version = "= 1.11.4"
  backend "s3" {}
  required_providers {
    external = {
      source  = "hashicorp/external"
      version = "= 2.3.5"
    }
  }
}
# Delays a read-only plan while its remote backend lock is held.
# Use only the dedicated lock-probe key, never the foundation state key.
data "external" "hold" {
  program = ["python3", "-c", "import time; time.sleep(30); print('{}')"]
}
output "probe" { value = data.external.hold.result }
