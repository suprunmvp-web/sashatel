# SashaTel Yandex Cloud infrastructure as code

**Two completely independent Terraform root states:** `environments/staging` (catalog `sashatel-staging`) and `environments/production` (catalog `sashatel-production`). The reusable module creates the same resource categories with different sizing/availability. `sashatel-admin` is reserved for shared IAM/audit/registry/state resources if/when necessary; no permissions over production are granted by this module.

## Provisioned by a manually approved Terraform apply (not yet applied)

Production owns its VPC and subnets. Staging reuses the existing VPC and matching-zone subnet found in `sashatel-staging` (1 VPC, 5 subnets on 19 Nov 2026); the staging root requires explicit existing VPC/subnet IDs and must never create a duplicate. Each environment owns an API VM, restricted security groups, and privately reachable Managed PostgreSQL 17 cluster. Staging has one DB host; production is planned with two hosts in separate availability zones and deletion protection. In both environments the API VM is a single instance until the in-memory refresh single-flight behavior is replaced. This is a **provisioning template**, not an assertion of production readiness or regional SLA.

**No direct inbound API port or PostgreSQL port.** VM has a public IP for bounded outbound connectivity and restricted SSH only from explicitly provided admin CIDRs. Internet access and host hardening, WireGuard/private access to Asterisk, TLS reverse proxy, image rollout, observability, database users, backups and domain DNS are separate deploy gates. The Yandex Cloud PostgreSQL v2 service uses private TCP port 6432. Do not open this to the internet.

## Before applying

1. In Yandex Cloud console collect the actual catalog IDs for staging/production, existing staging VPC network ID and subnet ID in the chosen zone, a reviewed Ubuntu image ID, an SSH **public** key and the admin IP/32. Check routing/CIDR overlap and preexisting security groups before planning. Folder *names* are not Terraform IDs.
2. Pin the validated provider dependency lock and select an encrypted remote state backend with per-environment access policies. The `.gitignore` excludes local state; **never run apply with uncontrolled local state**. Do not put DB passwords/tokens in Terraform variables or outputs.
3. Configure Yandex Cloud Workload Identity Federation (GitHub OIDC; exact repository/environment subject), separate staging/prod deployment service accounts and limited catalog roles. No global `editor`, no production credentials in staging.
4. Run `terraform init -backend=false && terraform fmt -check -recursive && terraform validate` inside each environment root. Run `terraform plan` only using a protected remote state and real catalog IDs, inspect all costs, provider grants, VM image, multi-zone availability and replication configuration. CI below only performs static checks.
5. Explicitly approve stage `terraform apply` via a protected runner. Do not apply production until deployment and restore tests pass in staging.
6. Provision a PostgreSQL admin/DDL migration identity and a non-owner runtime identity separately. Deploy containers by immutable SHA/digest after migration. Secure secret files outside Docker images, GitHub logs and Terraform state.

## Release gates

Staging: Node 24/Pg17 CI, migration checksum compatibility, non-owner RLS verification, public TLS/host checks, signed immutable build, health checks, controlled rollback, restore and SIP/PSTN validation. Production: *same tested image digest*, separate DB and credentials, explicit human approval, zero live-call dispatch until the two-leg ARI gateway and human-result billing evidence are verified. No fallback to mocks.

GitHub Actions validation is intentionally **non-deploying**. Terraform plans can incur no charges, but a real apply **will** create billable resources.

Official Yandex Cloud docs:
- https://yandex.cloud/en/docs/terraform/resources/mdb_postgresql_cluster_v2
- https://yandex.cloud/en/docs/terraform/resources/compute_instance
- https://yandex.cloud/ru/docs/iam/operations/wlif/setup-wlif
