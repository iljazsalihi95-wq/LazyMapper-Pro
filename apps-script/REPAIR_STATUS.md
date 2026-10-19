# Existing Apps Script / AppCreator24 repair checkpoint

19 October 2026. This is not a completed deployment.

## Observed live

- Signed-in AppCreator24 project: LazyMapper Pro., app ID 4189188.
- Signed-in Apps Script project: Lazymaper final v3 api.
- Script ID: 1glrIG7JUJPTK0qaIbXvdg9ofzY1naWEl9ZneAQRQdg-MvHJXBX5DliR4.
- Existing worker: lazyMapperBackgroundWorker; one-shot `.after(5000)` scheduling with an existence check. A running one-shot can prevent scheduling its successor.
- Trigger screen showed zero triggers. Execution history showed an earlier timed worker execution and no recent continuous worker runs.
- Private backup verified in Google Drive: BACKUP LazyMapper V3 para worker repair 2026-10-19, ID 1LrDHILqsb1sEizFNgEeYTNQlEuV4t1KGe3ypKFAmXcQ-5jiS7tKpC-WQ.

## Applied to editor

The full existing Code.gs was retained with these targeted edits:

1. Replaced the one-shot scheduler with a recurring one-minute trigger, a retained trigger ID, scheduler locking and migration from old triggers.
2. Added repairLazyMapperWorker() for installation/diagnosis without discarding existing jobs.
3. Bounded the existing cross-run Stalker retries using STALKER_RETRY_MAX.
4. Disabled the unauthenticated GET action that reset the administrator key. Existing Script Properties were not changed.

The editor accepted the replacement and the save operation was issued. The saving indicator subsequently disappeared. The browser then repeatedly timed out, so persistence readback, running the repair function, trigger verification and deployment update are NOT COMPLETED. Do not claim that the production web app is repaired yet.

WorkerRepair.gs contains the exact scheduler replacement for review. The complete original project remains in the private backup; it is not copied into this public repository because it contains private configuration.

## Tests

`node tests/test_gs_worker.cjs`: PASS for migration, duplicate prevention, missing-trigger recovery and releasing the scheduler lock after an error. This is a local mocked Apps Script test, not a live trigger execution.

## Linkage findings / remaining actions

- AppCreator24 has separate Ballina, Stalker, Xtream, Inspektim, M3U and server sections.
- Ballina currently uses emoji symbols rather than channel/logo image assets. No original image asset has been exported yet.
- The original Stalker HTML uses separate PORTAL_API, LIVE_API and DB_API deployments and a configurable background endpoint.
- The V3 project has four active deployments with different versions. The current GitHub HTML points to other legacy URLs. Do not replace all URLs blindly.
- Identify which active V3 deployment should serve background jobs, update that existing deployment with the saved code, run repairLazyMapperWorker(), and verify the recurring trigger plus a non-destructive diagnostic execution.
- Export and back up each AppCreator24 HTML section and image asset; preserve the original section references and access settings. Then synchronize those reviewed assets and endpoint roles into GitHub and build a new APK.
- AppCreator24 HTML edits, icon transfer and end-to-end source/worker/playback testing are NOT COMPLETED.
- The previously successful APK is a usable build-test checkpoint, not proof of this script/AppCreator24 synchronization.
