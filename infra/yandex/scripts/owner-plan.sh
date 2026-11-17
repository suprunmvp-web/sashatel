#!/usr/bin/env bash
# Owner runs locally after yc init. No apply, no credentials printed.
set +x
set -euo pipefail
umask 077
if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo 'Usage: owner-plan.sh bootstrap|staging /absolute/private.tfvars /absolute/private-output-dir [/absolute/backend.hcl]' >&2
  exit 2
fi
phase=$1; vars=$2; output=$3
case "$phase" in bootstrap) root=bootstrap;; staging) root=foundation;; *) exit 2;; esac
[[ "$vars" = /* && "$output" = /* && -f "$vars" ]] || exit 2
repo_root=$(cd "$(dirname "$0")/.." && pwd)
[[ $(terraform version -json | python3 -c 'import json,sys; print(json.load(sys.stdin)["terraform_version"])') = 1.11.4 ]] || exit 2
mkdir -p "$output"; chmod 700 "$output"
export YC_TOKEN
YC_TOKEN=$(yc iam create-token)
trap 'unset YC_TOKEN' EXIT
if [[ "$phase" = staging ]]; then
  [[ $# = 4 && "$4" = /* && -f "$4" ]] || exit 2
  terraform -chdir="$repo_root/$root" init -input=false -lockfile=readonly -backend-config="$4" > "$output/init.log" 2>&1
else
  terraform -chdir="$repo_root/$root" init -input=false -lockfile=readonly > "$output/init.log" 2>&1
fi
terraform -chdir="$repo_root/$root" plan -input=false -lock-timeout=5s -var-file="$vars" -out="$output/plan.bin" > "$output/plan.log" 2>&1
terraform -chdir="$repo_root/$root" show -json "$output/plan.bin" > "$output/plan.json"
python3 "$repo_root/scripts/review-plan.py" "$phase" "$output/plan.json"
echo 'Private plan saved locally. Do not upload binary, JSON or logs; review a sanitized summary.'
