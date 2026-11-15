# Audio task automation

Cloud automation **SashaTel — Audio Device Engineer** is enabled with
`RRULE:FREQ=HOURLY;INTERVAL=1`, no weekday or end-date restriction. First scheduled
check: 2026-11-15 18:35:30 UTC. This is the product's cloud scheduler, not a launchd
job, cron on the owner's Mac or a repository workflow.

Scope: PR #3 Tech Lead feedback; Issue #5 and explicitly related Audio Device
Service follow-ups; CI/reviews for this audio branch family only. Permitted work
is audio and Electron security; UI/HTML/CSS, Core, Backend, Asterisk and merges
are forbidden. New independent tasks get audio-only branches and Draft PRs;
new comments on an existing fix update that fix instead of duplicating it.

Use [`AUTOMATION-STATE.json`](./AUTOMATION-STATE.json) plus GitHub source events,
refs and all open/closed audio PRs as the durable record. Temporary shell state
and shared GitHub author identity are insufficient. Source key includes repo,
Issue/review-comment ID and substantive revision; CI includes run/head SHA.
Match content as well as `updated_at`: a timestamp-only status change is not a
new implementation task. Preserve the origin key in PR descriptions.

Before working, check whether that key is completed/ready for review or in
progress. Skip handled revisions; resume existing work rather than create a
duplicate PR. A later substantive review/CI failure gets its own event key but
normally stays in the same fix PR. Publish in-progress ownership under a stable
remote audio task branch with a non-force ref create/update; a conflicting
active owner must not start parallel changes. Do not overwrite or force-push a
branch to obtain ownership. If ownership cannot be established, report a blocker.
This runbook is agent-level deduplication, not a claim of a distributed exactly-once
execution guarantee from the scheduler.

The saved prompt requires full tests and a Draft PR before marking work handled;
blocked tests/publication stay in progress/blocked. It separates mocked hardware,
real Electron synthetic samples and physical Mac evidence. No relevant changes
means no user notification; meaningful results or blockers are reported.

Creation and enabled hourly schedule were confirmed by the scheduling tool.
The future execution environment is marked inherited, with no environment list
returned. The current development shell is cloud-hosted, but the first scheduled
run has not happened; future shell availability/autonomous code execution is
**not yet verified**. The prompt must report unavailable shell/credentials rather
than pretend a fix or tests ran. Scheduled polling does not depend on the owner's
Mac. If scheduled runs lack a development shell, use a GitHub Actions scheduled
cloud runner plus an authorized Codex/API job as an alternative; no such workflow,
credentials or additional automation have been installed by this change.
