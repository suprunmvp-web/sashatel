ALTER TABLE control.managed_trunks
 ADD COLUMN auth_mode text NOT NULL
 DEFAULT 'registration_credentials'
 CHECK(auth_mode IN ('registration_credentials','ip_authentication')),
 ADD COLUMN transport text NOT NULL
 DEFAULT 'udp'
 CHECK(transport IN ('udp','tcp','tls')),
 ADD COLUMN desired_active boolean NOT NULL DEFAULT false,
 ADD COLUMN last_checked_at timestamptz,
 ADD COLUMN last_success_at timestamptz,
 ADD COLUMN diagnostic_code text;

GRANT UPDATE (
 desired_active,
 last_checked_at,
 last_success_at,
 diagnostic_code
) ON control.managed_trunks TO control_runtime;

GRANT UPDATE (active)
 ON control.trunks TO control_runtime;
