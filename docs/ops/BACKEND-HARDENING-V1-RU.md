# SashaTel — Backend Hardening v1 / release checklist

Scope: **Backend only**. Does not alter Web components or activate PSTN calls.

## Changes
1. Login/register: no shared-IP lockouts behind Cloudflare/Vercel. Limits by
   preauth browser plus existing per-email account checks. **Not a WAF**:
   rotating cookies bypasses browser limits, therefore the trusted edge must
   independently rate-limit suspicious traffic and bot registration.
2. Read-only account and internal organization reads do not lock the shared
   browser/user/session rows. Mutating paths (login, refresh, verification,
   organization review) still use exclusive database locks.
3. `web_auth.account_organizations`: one indexed account-scoped query replaces
   per-tenant N+1 reads. `internal_organizations_page`: bounded
   `GET /v1/internal/organizations?limit=50&offset=0` response
   `{items,next_offset}`; defaults to 200 for compatibility with the current Web.
   Web UI pagination is **not** in this Backend PR.
4. Internal `owner` role exists independently from client owner. DBA provisions
   it explicitly; no registration/email-domain privilege escalation. Reviewers
   can approve/reject; only internal `owner` or `admin` may reopen a
   **rejected** organization with written evidence:
   `POST /v1/internal/organizations/reopen`
   `{organization_id,evidence_reference,explanation}`.
   Response: `{organization_id,verification_status:'unverified',review_id}`.
   Full SQL history + `web_auth.audit`. Reopening never activates telephony.
5. Pool catches and redacts idle PostgreSQL connection errors so dropped idle
   sessions do not terminate the Node process. Web errors carry `x-request-id`
   and sanitized internal error metadata without request bodies.
6. Migration `011-auth-read-performance.sql`: functions, indexes, staff role,
   review lifecycle additions. Apply **after 010**.

## Release gate (no automated deployment)
- Green Backend Control Plane workflow and immutable image digest from the
  matching SHA, with PostgreSQL tests.
- DB available; make Yandex Cloud snapshot / validate existing PITR and
  backup status before applying the additive migration 011.
- Run `migrate.ts` as separate file-backed DBA credentials. Verify checksum
  entry for 011, no schema drift, and `/ready`.
- Deploy exact immutable Backend image on VM using the existing rollback
  mechanism; preserve network, mounts, environment and local port 8083.
- Confirm normal customer receives 403 from internal APIs, staff `owner`
  can access review and reopen, reviewer cannot reopen.
- Replay more than 20 unrelated login attempts from the same trusted proxy
  egress address with independent browser cookies: no cross-account 429.
- Audit metrics for connection errors, 429, 503, request-id correlation,
  queue backlog and auth p95. Test restore in isolation before commercial SLA.
- Keep `LIVE_CALL_DISPATCH=disabled` until separate PBX/commercial readiness.

## Approved first staff owner
To be executed only with a verified privileged DBA session and the
**previously approved email** supplied out-of-band:
```sql
INSERT INTO web_auth.internal_staff(user_id,role)
SELECT id,'owner' FROM control.users
WHERE lower(login)=lower(:approved_owner_email)
 AND active AND email_verified_at IS NOT NULL
ON CONFLICT(user_id) DO UPDATE SET active=true,role='owner';
```
Check **exactly one** matching account before execution; keep the SQL action
in the DBA operations log. Staff `owner` does **not** grant customer
organization ownership.

## Explicit remaining risks
- Browser-cookie limiting alone is insufficient against distributed abuse:
  configure per-IP, ASN, and global edge WAF controls with a known trusted
  proxy chain; do not blindly trust `X-Forwarded-For`.
- Managed PostgreSQL, VM and tunnels still require independent backup/restore,
  observability and availability testing. No measured peak RPS or p99 yet.
- Resend outbox loop shares the Node API process. Split it into a dedicated
  worker with queue lag metrics before scaling beyond a pilot.
- Expired sessions, browser records and mail histories need an audited,
  FK-safe retention policy. **Do not delete audit or billing evidence.**
- The Web admin list must adopt `next_offset` to show organizations beyond
  the first page. Synchronize contract with the separate UI agent.
