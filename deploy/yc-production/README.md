# SashaTel production — infrastructure ready for validation, NOT a live rollout

Yandex Cloud catalog: `sashatel-production`. It is an independent Terraform root under `deploy/yc-infra/environments/production`. No shared PostgreSQL, VPC, credentials or deploy identity with staging.

**No production application Compose file yet by design.** The current `backend/server.ts` starts only in `EMAIL_MODE=sink` with `LIVE_CALL_DISPATCH=disabled` and is not a legitimate customer-facing release. Copying its staging container into production would deploy a nonfunctional email sink and imply readiness that does not exist. Once a real email provider, ARI two-leg gateway and validated commercial release exist, production will use its **own** protected deployment manifest pointing to the exact immutable staging-tested image digest.

Before provisioning: obtain real catalog ID, budget limits, VM image, confirmed two-zone PG cluster support and separately protected Terraform remote state. Review Terraform plan and cost, verify IAM federation subject constraints. No `terraform apply` in feature-branch CI.

Before production release: staging restore drill and rollback, independent security review, immutable artifact provenance, public TLS/reverse proxy, controlled private PBX networking, correct payment reconciliation, human-detection evidence, durable idempotent ARI event ingestion and SIP/PSTN test. Apply migrations without destructive rollback and without production test fixtures. Require explicit manual approval.

Production workers must be scaled/released separately from API, after removal of in-memory Web refresh single-flight. Neither resource provisioning nor live calls are authorized by this document.
