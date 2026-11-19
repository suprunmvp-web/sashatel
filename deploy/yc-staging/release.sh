#!/usr/bin/env bash
# Safe single-command SashaTel staging API rollout on the provisioned VM.
# Usage: sudo ./release.sh /etc/sashatel/staging/staging.env
# Never invokes PSTN; production is a separate environment and is not supported.
set -Eeuo pipefail
umask 077

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: release.sh /absolute/path/to/staging.env" >&2
  exit 2
fi
config="$(realpath "$1")"
if [[ "$config" != /* || "$(basename "$config")" == 'staging.env.example' ]]; then
  echo "Only a private, absolute staging environment file is accepted" >&2
  exit 2
fi
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose="$root/compose.yaml"
command -v docker >/dev/null || { echo "Docker required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl required" >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose plugin required" >&2; exit 1; }

# Treat the current private configuration as authoritative; refuse any floating tag.
# Do NOT source the env file or evaluate shell commands inside it.
image="$(sed -n 's/^BACKEND_IMAGE=//p' "$config" | tail -n 1)"
if [[ ! "$image" =~ ^cr\.yandex/[a-z0-9]+/sashatel-backend@sha256:[0-9a-f]{64}$ ]]; then
  echo "BACKEND_IMAGE must be pinned to a cr.yandex SHA256 digest" >&2
  exit 2
fi
if ! grep -qx 'STAGING_SECRETS_DIR=/etc/sashatel/staging' "$config"; then
  echo "Staging secrets must live outside the repository at /etc/sashatel/staging" >&2
  exit 2
fi
for name in database-url migration-database-url database-ca.pem auth-key; do
  if [[ ! -s "/etc/sashatel/staging/$name" ]]; then
    echo "Missing required private secret file: $name" >&2
    exit 2
  fi
done
if [[ "$(stat -c %a /etc/sashatel/staging/auth-key)" != 400 &&
      "$(stat -c %a /etc/sashatel/staging/auth-key)" != 440 ]]; then
  echo "auth-key requires explicit read-only permissions for container UID 1000" >&2
  exit 2
fi

compose_run() {
  docker compose -p sashatel-staging --env-file "$config" -f "$compose" "$@"
}
tmp="$(mktemp -p /tmp sashatel-staging-release.XXXXXXXX.env)"
chmod 600 "$tmp"
docker_auth="$(mktemp -d -p /tmp sashatel-docker-auth.XXXXXXXX)"
chmod 700 "$docker_auth"
trap 'rm -f "$tmp"; rm -rf "$docker_auth"' EXIT
# The VM has a dedicated read-only Container Registry service account.
# Metadata token is short lived and never goes into GitHub, Terraform or logs.
metadata='http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token'
iam_token="$(curl --fail --silent --show-error --max-time 5 \
  -H 'Metadata-Flavor: Google' "$metadata" | jq -er '.access_token')"
export DOCKER_CONFIG="$docker_auth"
printf '%s' "$iam_token" | docker login --username iam --password-stdin cr.yandex >/dev/null
unset iam_token
printf 'BACKEND_IMAGE=%s\n' "$image" > "$tmp"

echo "Verifying staging Compose and pulling immutable backend image"
compose_run config --quiet
compose_run --profile migration pull api migrate
echo "Executing checksum-guarded one-shot PostgreSQL migration"
compose_run --profile migration run --rm --no-deps migrate

existing="$(compose_run ps -q api || true)"
previous=""
if [[ -n "$existing" ]]; then
  previous="$(docker inspect --format '{{.Config.Image}}' "$existing" 2>/dev/null || true)"
fi

echo "Deploying staging API on loopback only (LIVE_CALL_DISPATCH=disabled)"
compose_run up -d --no-deps --force-recreate api

ready=false
for _ in {1..30}; do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8080/ready >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 3
done
if [[ "$ready" != true ]]; then
  echo "Staging /ready failed; attempting application-only rollback (never rolling DB schema back)" >&2
  if [[ -n "$previous" && "$previous" =~ ^cr\.yandex/[^[:space:]]+@sha256:[0-9a-f]{64}$ ]]; then
    printf 'BACKEND_IMAGE=%s\n' "$previous" > "$tmp"
    docker compose -p sashatel-staging --env-file "$config" --env-file "$tmp" -f "$compose" up -d --no-deps --force-recreate api
  else
    echo "No approved previous immutable digest; cannot roll back automatically" >&2
  fi
  exit 1
fi
echo "Staging Backend API healthy on 127.0.0.1:8080; no PSTN enabled"
