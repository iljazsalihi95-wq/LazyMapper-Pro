# Existing LazyMapper deployment

This is the gateway for this repository's existing UI and backends. It is not a
second channel database. Deployment has **not** been performed on 5 November 2026:
the available Cloudflare browser is signed out. The existing Apps Script editor
also requires a signed-in session; its private code export returned 403.

## Data flow

- Browser -> same-origin Worker -> fixed existing Apps Script deployment for
  SERVER_01–20 lists, importBatch, Stalker adapters and persistent Stalker jobs.
- Browser -> Worker -> existing private Python analyzer for inspection jobs,
  history, controls and pinned-DNS JSON/M3U transport.
- Android keeps its existing direct authorized portal transport, Media3/LibVLC
  players and encrypted WorkManager analyzer session. The file-based APK does not
  share the hosted site's Access cookies. Its advanced legacy configuration remains
  available until a native Access sign-in integration is implemented and tested.

The authoritative stores remain Google Sheets/Script Properties and the analyzer's
persistent SQLite volume. A second D1/Queues queue is deliberately not provisioned
without inspecting the existing account: it would duplicate job ownership.
FFmpeg/FFprobe are native processes in the existing container, not Worker APIs.
The Worker cannot provide verified sample decoding if that analyzer is absent.

## Configure the existing Worker

1. Inspect Workers & Pages in the user's account. Set `name`, existing route/custom
   domain and any existing bindings in `wrangler.jsonc` to that actual Worker.
   Do not deploy over an unrelated Worker or create another project accidentally.
2. Protect that entire hostname with Cloudflare Access. Allow only the intended
   administrator(s); no Bypass or Everyone policy. Keep `workers_dev` and preview
   URLs disabled. `run_worker_first: true` also validates JWTs before static assets.
3. Set `ACCESS_ISSUER` to the exact HTTPS team origin without a trailing slash,
   `ACCESS_AUD` to the existing Access application's AUD and `ADMIN_EMAILS` to the
   explicitly authorized administrator email(s). The Worker checks the RSA
   signature, issuer, audience, expiry, issued-at and administrator claim.
4. Set `ANALYZER_ORIGIN` to the fixed HTTPS origin of the existing private analyzer.
   Preserve its persistent `/data` volume, one worker process and production HTTPS
   reverse proxy. Configure its `LM_ALLOWED_HOSTS` and optional `LM_ALLOWED_PORTS`
   with exact authorized provider/CDN destinations; all DNS addresses and redirects
   are checked and connections pinned to a public address. Do not add private or
   loopback targets to work around Stalker placeholder commands.
5. Set `PORTAL_ORIGINS` to exact authorized portal origins (including explicit
   port where needed), comma-separated. This restricts the Apps Script adapter
   destinations; it does not grant permission to bypass provider authentication.
6. Use Cloudflare Secrets for the existing import key and analyzer token:

   ```sh
   npx wrangler secret put GAS_API_KEY --config cloudflare/wrangler.jsonc
   npx wrangler secret put ANALYZER_TOKEN --config cloudflare/wrangler.jsonc
   ```

   Enter values using the provider's secure input. Never put them in this file,
   `vars`, HTML, URLs, issues or logs. `GAS_URL` already names the verified existing
   deployment; retain it when updating its version.
7. Generate assets and review the dry-run before deployment:

   ```sh
   python scripts/sync_ui.py
   npx wrangler deploy --dry-run --config cloudflare/wrangler.jsonc
   npx wrangler deploy --config cloudflare/wrangler.jsonc
   ```

Only four frontend HTML files enter `cloudflare/public`; no repository directory,
private configuration or backend source is published as static content.
The rate-limit binding is required; a missing binding fails closed. Limits apply
per Cloudflare location, not as a global billing quota. Request/URL logging is
disabled here because requests can contain signed provider URLs.

## Existing Apps Script

Open the existing project ID recorded in `apps-script/REPAIR_STATUS.md`, export a
private backup, inspect its current complete code and SERVERS mapping, then
**replace the existing V4 repair block** with `apps-script/RepairV4.gs`.
Do not append this wrapper a second time: it captures existing entry points.
Do not overwrite the original Code.gs with this partial repair block.
Run scheduler diagnostics and update the **existing** deployment version without
changing the deployment URL. This repository alone cannot prove the live base
`upsertItems_` implementation is idempotent. Check repeated imports in the target
Sheet with an explicitly identified small authorized batch before claiming it.

`statusJob` is accepted as an alias of `jobStatus`. importBatch rejects untrusted
GET calls, unknown destinations, oversized batches, invalid item identities and
cross-server items, and collapses repeated identities inside one input batch.
The original adapter owns persisted upserts and existing server configuration.

## Acceptance checks after authentication

- Access login works; unsigned/expired/wrong-audience requests fail with 401.
- Hosted UI discovers `/api/session` and does not display key inputs.
- All 80 server/type list calls return the intended server; header rows are omitted.
- Resolve the repeated header rows on SERVER_03 and blank SERVER_ID metadata in
  SERVER_10 VOD/SERIES only after confirming their backing sheets.
- Import a small real batch, verify its destination and repeat it to check upserts.
- Exercise pause/resume/cancel for a real Stalker job, inspect the recurring trigger
  and check that in-flight network results cannot overwrite a paused/cancelled job.
- Test source JSON and M3U through the pinned analyzer transport with authorized
  provider credentials, including auth, rate-limit, invalid JSON and timeout errors.
- Test HLS, TS and MP4 against provider URLs on an actual Android device. A successful
  CREATE_LINK or HTTP 200 is not playback. Browser CORS/codec failures remain UNKNOWN.

Local M3U/Xtream **imports** checkpoint after acknowledged batches, but do not keep
running after the page closes. Their payloads stay in memory; only a SHA-256
fingerprint and acknowledged offset are persisted. Re-open/re-select the exact
playlist to resume. Background Stalker imports and analyzer jobs run in the existing
server-side queues. Fully server-side M3U/Xtream import staging remains outstanding.
