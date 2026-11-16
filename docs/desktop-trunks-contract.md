# Desktop · Trunks API v1 (#19)

Desktop maps the schema published in [Backend PR #14](https://github.com/suprunmvp-web/sashatel/pull/14). Requests use tenant-scoped Bearer authorization with `trunks.manage`. Desktop sends POST /v1/trunks with `Idempotency-Key`, name UIS, `auth_mode: registration_credentials`, `registrar_host`, `registrar_port`, `username`, and write-only `password`. GET /v1/trunks returns `{ items }`. DELETE /v1/trunks/{id} returns 202 and the deletion acknowledgement. Every successful mutation reloads the list, and “Обновить статусы” fetches a fresh list. Backend v1 owns provisioning retries. The production UI hides the mock's manual retry action.

## Pilot configuration

Provide `SASHATEL_BACKEND_ORIGIN` as a trusted HTTPS origin and `SASHATEL_BACKEND_TOKEN` as an existing short-lived Backend session through the launcher environment. Main consumes the token at startup and clears its environment entry before creating the renderer. Use an approved launcher that avoids shell history. After expiry/revocation launch with a fresh session. Interactive sign-in and session renewal can later replace this credential source in main. The tenant comes from the Backend session. Desktop accepts no renderer-supplied origin, token or tenant ID.

The three explicit IPC methods use the existing window/frame policy. Main uses Node fetch with redirect rejection, timeout and no cache. Responses are projected onto public trunk fields. Only fixed error codes cross IPC. The SIP password is cleared on submit and is used only for the current POST. There is no local request journal, retry queue, password persistence or request logging. After an ambiguous write, refresh status before explicitly submitting again. No automatic POST replay occurs.

Desktop displays Backend statuses without deriving call eligibility. `registered` indicates registration only. No change to renderer network policy, call transport or Asterisk. The mock remains a fixture for component tests. Until the v1 routes ship and a trusted HTTPS environment is available, live acceptance remains pending.
