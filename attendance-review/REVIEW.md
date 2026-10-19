Attendance boundary review ? 2026-10-19

The previous local patch correctly removed the 06:00 expiry condition, but did not identify automatic versus device checkout, committed the two workdays separately, and relied on a process-local scan lock. These gaps have been corrected locally. Nothing was deployed, and the running deployment was not inspected.

Only three production files changed: backend/models/Attendance.js, backend/utils/reportCron.js, and backend/routes/attendanceFingerprint.routes.js. Existing localized messages, file line-ending styles, five-minute cron frequency, offline timestamp limits, and synchronization grace remain. No application dependencies were added.

| Rule | Result |
| --- | --- |
| 06:00 PKT | Changes workday allocation only; never expires an open shift |
| Manual 02:00 to 15:00 | Previous workday: 240 minutes; current workday: 540 minutes |
| Twenty-hour limit | Exact original IN + 20 hours, even if cron processes it later |
| Provenance | checkInSource/checkOutSource distinguish fingerprint, boundary, and automatic entries |
| Boundary allocation | No clientId is generated for 06:00; sessionStart links both workday segments |
| 30-minute minimum | Preserved, including scans across 06:00 and delayed offline correction |
| 10-minute recheck-in | Preserved across workdays, including automatic closure |
| Retry idempotency | Accepted clientId and both daily records commit in the same transaction |
| Multi-shift attendance | Earlier completed durations and markedByFace are retained |
| Offline replay | Uses validated scannedAt; a delayed real OUT can atomically replace a prior automatic allocation |
| Out-of-order replay | Older scans after a newer real punch receive HTTP 409/action rejected rather than changing newer attendance |
| Atomicity | Failure before commit rolls back both workdays, the scan id, and automatic-allocation correction |
| Concurrency | Fingerprint and cron acquire the same employee version write inside the transaction; MongoDB retries transient conflicts |

The employee __v increment serializes these attendance transactions across processes without changing employee profile timestamps. Attendance optimisticConcurrency additionally rejects stale document saves. Existing face/manual controller flows were not refactored into transactions; this review's coordinated transaction scope is fingerprint scans and auto-checkout.

Deployment prerequisite: the database must support multi-document transactions (MongoDB replica set, including Atlas, or a sharded cluster). Standalone MongoDB is unsupported by this atomic flow; failures return errors without falling back to partial writes. The production topology and deployed version remain unverified.

Automatic processing still runs on the existing cron schedule and retains its 10-minute synchronization grace. The stored automatic OUT timestamp is exact even when processing runs later. Rows already marked missed or automatically closed by older code without provenance were not rewritten; historical correction needs a separate audit.

A kiosk must retain rejected or failed queued scans for review/retry, and send offline scans in chronological order with their original clientId/scannedAt. Windows kiosk source was not included in this revised backend-only request and was not modified or validated.

Verification: 35 new real-MongoDB integration tests and 32 existing backend regression tests passed. The integration suite uses a disposable local single-node replica set and independent handler instances sharing that database; it does not connect to .env, Atlas, or production. Failure injection covers second-workday saves, commit failure, and replay correction. Independent handler instances exercise database serialization without sharing the inFlight set. It is not a hardware kiosk or deployed HTTP load test.

The old attendance-dates assertions that demanded missed checkout at 06:00 were replaced by the integration suite. Calendar/absence reconciliation tests remain, and the integration suite also verifies history and timer state after 06:00 and expiry.

Complete source files, tests, a unified patch, and observed test results are included in the ZIP. The ZIP excludes .env, credentials, node_modules, and the temporary MongoDB runtime.

To reproduce on Windows from the repository root, install the test-only runtime into a temporary folder, then run:

    $reviewTools = Join-Path $env:TEMP 'attendance-review-tools'
    npm install --prefix $reviewTools --no-save --no-package-lock mongodb-memory-server@10.2.0
    $env:ATTENDANCE_TEST_TOOLS = $reviewTools
    node --test backend/scripts/attendance-boundary.test.cjs
    node --test backend/scripts/attendance-dates.test.cjs backend/scripts/attendance-export.test.cjs backend/scripts/deleted-users.test.cjs backend/scripts/biometrics.test.cjs backend/scripts/employee-list.test.cjs

The first integration run downloads a local MongoDB binary. Test runtime installation does not change the app package manifests.
