# LazyMapper PRO — implementation checkpoint, 19 October 2026

Repository: `iljazsalihi95-wq/LazyMapper-Pro`, branch `main`.
Backup: `backup/pre-mapper-audit-20261019` at `6a88cbf8c41fded6d25f6450864c64f851c870f4`.

## Implemented in this checkpoint

- HTTP 200 or receipt of bytes no longer reports WORKING in either web or Android probes.
- Python private backend with an SQLite queue, a single bounded worker, one timeout retry, restart recovery, and 30-day completed-history retention.
- Authorized exact-host allowlist, public-address validation, pinned DNS address per connection, TLS verification, redirect checks, byte limits, time limits. Each HLS child URL is checked separately. No key fetching.
- Plain HLS master/media manifest traversal, first segment availability, bounded FFprobe metadata and FFmpeg decoding. WORKING means the downloaded sample decoded with advancing media timestamps; sustained playback/buffering is NOT TESTED.
- Bearer-authenticated job submission, status/history, JSON/CSV export. Token configured by environment; web session keeps it only in memory; Android explicitly stores an encrypted backend session for WorkManager. Pending source URLs are private queue data and are erased from completed jobs. Redirect URLs are not exported into history.
- Settings and Stream Analyzer/History in the existing HTML. Existing server integrations remain in place.
- M3U metadata preservation: tvg-id/name/logo/country, group-title, names containing commas, directives between EXTINF and URI, original stream URL, M3U export, file drag/drop. HLS manifests are treated as one source stream, not a list of segments masquerading as channels.
- Browser preview using HTML video, fullscreen, retry and fit/fill, subject to browser codec/HLS support.
- Existing native Media3 preview gains retry, aspect ratio, immersive display, subtitle button, buffering indicator and lifecycle restart. Android native probe stays UNKNOWN unless playback evidence is available through the backend.
- Xtream login now requires auth=1 and an active account.
- CI checks run before APK compilation.

## Verification

Local: 10 Python tests PASS, including actual decoding of locally generated MPEG-TS media, malformed media rejection, HLS fixtures, authentication and durable queue recovery. Node M3U roundtrip and UI JavaScript syntax tests PASS.

Browser visual test: TEST NOT COMPLETED locally — Playwright is present but its Chromium executable is absent.

Actual STB/Stalker credentials, real Xtream account, real stream playback on an Android device, Media3 device playback, AppCreator24 file/download behavior: TEST NOT COMPLETED. No authorized integration fixture/account was supplied in this task.

## Deployment — required before background testing is available

GitHub Actions builds and tests code; it is not a permanent backend host.

Install the backend on an authorized HTTPS server. `backend/Dockerfile` is provided. Keep the API bound privately behind an HTTPS reverse proxy with request size, connection and request-timeout limits. Do not expose Python's HTTP server directly to the internet.

Environment:

- `LM_ADMIN_TOKEN`: newly generated random token of at least 32 characters, supplied through a private environment/secret manager. Never reuse a password posted in chat.
- `LM_ALLOWED_HOSTS`: comma-separated exact authorized source/CDN domains, including redirect/segment domains. No wildcards or private IPs.
- `LM_ALLOWED_PORTS`: optional additional explicitly authorized source ports.
- `LM_ORIGINS`: exact HTTPS web frontend origin(s). Opaque `null` file origins are intentionally unsupported; AppCreator24 should load an HTTPS-hosted page for authenticated API use.
- `LM_DB`: private persistent SQLite path. Only run one backend process against a queue database.

Run `python backend/server.py` with FFmpeg/FFprobe installed, or build/run the Docker image with a persistent `/data` volume. Configure the deployed HTTPS API URL in Settings. Do not put administrator tokens in the web URL or repository.

## Remaining work — project is NOT finalized

- Deploy backend using the user's hosting account; no hosting connection was available in this task.
- Complete separate functional Dashboard/playlist/server managers, encrypted credential vault, private playlist URLs and export rights policy. Current importBatch integrations are legacy and have NOT been audited end-to-end.
- Complete the requested 17-section design, logos, manual classification and country/category mapping.
- Audit and implement authenticated Stalker adapter with controlled pagination, session diagnostics and supported provider variants. Existing adapter is not claimed verified.
- Complete Xtream episodes/EPG and structured server errors.
- Sustained buffering/startup testing, DASH analysis, detailed DNS/TCP/TLS timing, screenshot permissions and reliable geo/DRM evidence. HTTP 403 is AUTH REQUIRED, not proof of a geographic restriction.
- Full Kotlin native navigation/local database/file picker. Current shell remains Java/WebView with native Media3 and Kotlin LibVLC previews; it is not yet the requested full Kotlin app.
- Kotlin WorkManager backend job submission/polling is implemented with connectivity constraints and bounded retries. Secrets and pending signed URLs are encrypted with Android Keystore AES-GCM; WorkManager inputs contain only opaque references. Configure the backend in Settings, then use manual Stream Analyzer to enqueue a native job. Device/process-restart tests are TEST NOT COMPLETED.
- Native LibVLC fallback is now implemented in Kotlin as a separate native surface with audio/subtitle selection. Device playback is TEST NOT COMPLETED. Library ABI/16 KB page-size and distribution licensing checks remain required before a Play release.
- All live integration/device tests from the user's acceptance checklist remain mandatory.

No channel redistribution, DRM extraction, authentication bypass or mass scanning is implemented.
