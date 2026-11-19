# SashaTel staging infrastructure identities (2026-11-19)

This file contains only public, non-secret service account IDs. Identity presence does not confer authorization.

| Identity | Yandex Cloud ID | Purpose |
| --- | --- | --- |
| sashatel-staging-infra | `aje639c2l6mhktjq4lpp` | Protected Terraform plan/apply for staging folder ONLY |
| sashatel-staging-pull | `ajet0imh2qqqtr55h5im` | VM-associated, registry pull-only |
| sashatel-staging-deploy | `ajeja1u2timegoko4vn9` | Current branch-bound OIDC build and registry image push |

Folder ID `b1gi9a6gkr55k6csn9s`; registry `crpjs1v75pobqqd0ij5t`. Production is not authorized by these identities.

## Staging provisioning IAM permissions — candidate minimal service roles

Restrict **the staging-infra service account** to these service roles *on staging folder only*, pending validation through a read-only Terraform plan:
- `compute.admin` for API VM and disks
- `managed-postgresql.editor` for staging managed PostgreSQL
- `vpc.user` to use existing VPC/subnet
- `vpc.securityGroups.admin` to create/maintain dedicated API/DB security groups

To attach the pull identity to the VM, grant `iam.serviceAccounts.user` to the **infra identity on the pull service account resource only**, not on the whole folder, if UI supports the scope. No general editor/admin grant; no privileges in `sashatel-production`. The staging pull account should have `container-registry.images.puller` on the **staging registry resource**, not the entire folder. If the console UI lists it at folder level, narrow the scope before production.

When starting Infrastructure as Code from GitHub, create an **independently protected staging-infra GitHub Environment** that requires a deployment reviewer and cannot be triggered by arbitrary PRs, and bind its exact actual GitHub OIDC Subject to `sashatel-staging-infra`. Do not reuse the existing branch-bound image-publishing federated credential as a privileged Terraform apply credential; test the actual subject from a non-mutating OIDC check before binding. Keep its OIDC audience `https://github.com/suprunmvp-web`. Do not create static API keys.

## Still mandatory before applying

- Real resource budget and estimated paid resource costs, approved before apply.
- Trusted reviewed Ubuntu image ID, SSH admin CIDR and actual SSH public key.
- Protected, encrypted remote Terraform state with separate staging authority and safe state locking.
- Verified IAM plan/read and no wildcard editor.
- Create PostgreSQL owner/runtime logins and DB, install CA/secret files outside GitHub/VM metadata, protected frontend origin and HTTPS ingress.
- Review a real Terraform plan and confirm it creates only staging VM, security groups and PostgreSQL 17. **Static terraform validate ≠ permission check or resource creation.**

Relevant official docs:
- https://yandex.cloud/en/docs/compute/security/
- https://yandex.cloud/en/docs/managed-postgresql/security/
- https://yandex.cloud/en/docs/vpc/security/
- https://yandex.cloud/en/docs/iam/operations/wlif/setup-wlif
- https://yandex.cloud/en/docs/compute/operations/vm-connect/auth-inside-vm
