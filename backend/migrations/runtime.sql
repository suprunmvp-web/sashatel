-- Run as the migration owner after provisioning the control_runtime login externally.
GRANT USAGE ON SCHEMA control TO control_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA control TO control_runtime;
GRANT UPDATE (phone_epoch) ON control.users TO control_runtime;
-- PostgreSQL requires UPDATE on at least one column to acquire row locks.
GRANT UPDATE (id) ON control.organizations, control.memberships TO control_runtime;
GRANT UPDATE (available) ON control.wallets TO control_runtime;
GRANT INSERT ON control.sessions, control.devices, control.calls, control.outbox,
  control.call_events, control.usage_ledger, control.number_attempts TO control_runtime;
GRANT UPDATE (revoked_at) ON control.sessions TO control_runtime;
GRANT UPDATE (state) ON control.calls TO control_runtime;
GRANT UPDATE (used) ON control.number_attempts TO control_runtime;
GRANT UPDATE (claimed_at,completed_at) ON control.outbox TO control_runtime;
