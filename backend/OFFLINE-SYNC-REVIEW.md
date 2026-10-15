# Offline fingerprint synchronization source review

Status: implementation pending essential kiosk source. No application behavior or production data changed.

## Confirmed flow

The active fingerprint handler starts at routes/attendanceFingerprint.routes.js:449. It authenticates a bearer token, scopes users to the configured tenant, requires userId and an enrolled fingerprint, and excludes Deleted users. Employee name alone is not sufficient. It reads only userId and uses server time; offline, scannedAt and clientId are ignored.

Workdays begin at 06:00 Asia/Karachi. The route toggles an open shift to checkout with a 30-minute minimum, and permits a new shift 10 minutes after checkout. Daily duration accumulates across nested shifts. The in-memory lock covers only one process and does not coordinate PM2 workers, face/manual attendance or cron.

Attendance.js uniquely indexes userId/date. Preserve daily documents, accumulated minutes, employee/tenant references and nested shift semantics. Reports select the last completed, non-missed session for summary times.

runAutoCheckOut runs every five minutes. Earlier workdays and shifts over 20 hours are marked missed, with checkout left missing. Earlier completed shifts preserve Present; otherwise status becomes Absent. Errors are swallowed after logging. Because the fingerprint route runs this before finding an open shift, an overnight shift crossing 06:00 may be finalized before the existing split branch is reached. Passing historical time cannot repair an already-finalized session.

Fingerprint attendance does not prohibit off-day/vacation punches or independently reject all non-Active statuses. Off-days/vacations affect absence generation in attendanceController.js. Introducing new blanket restrictions would change policy.

## Essential missing information

No C# source was found in this workspace. Need ApiClient.cs, OfflineQueue.cs/OfflineSupport.cs and relevant KioskForm.cs, or their local directory. Verify serialized payload, identifier format, queue ordering, duplicate handling, retry behavior and responses that delete queued scans before choosing error codes.

config/db.js connects using MONGO_URI, but the actual production topology is unverified. Need a credential-free description: Atlas/replica set/sharded cluster or standalone, MongoDB version and PM2 worker count. Do not share secrets. No production database was contacted.

## Implementation constraints

- Keep online routes and response formats; validate offline IDs and timezone-bearing ISO dates before writes. Use event time for workdays and durations, a documented small future tolerance and configurable seven-day lookback.
- Add an organization-scoped event ledger with a database unique index and canonical payload hash. Exact retries are duplicates; altered payload reuse is a conflict. Do not expire identifiers while retry remains possible.
- Commit receipt, attendance writes and result in one verified MongoDB transaction. A separate receipt followed by attendance save is not crash-safe. Create collections/indexes explicitly before enabling sync. If transactions are unavailable, fail closed for offline writes pending a reviewed recovery design.
- Transactions alone do not serialize all writers. Address document version checks and races with cron, face/manual updates and daily-document creation. Do not claim coordination from a fingerprint-only lock.
- Use an ordered batch contract or persistent conflict-aware ordering. A single toggle request without sequence/action or a complete pending batch cannot prove an earlier scan will not arrive later. Never apply a historical event to the latest open shift blindly.
- Already missed/finalized records and later live punches need a retained conflict when reconciliation is unsafe. Do not silently reverse payroll-relevant history.
- Final HTTP status and queue-retention behavior depend on the actual C# contract. Success must mean durable processing; unknown commit outcomes must remain recoverable.

## Verification and deployment still required

Test only an isolated database. Cover online flow, delayed IN/OUT, duplicates and concurrent retries, payload mismatch, crash/abort/unknown commit, timestamp rejection, multiple sessions, 30-minute/10-minute/20-hour rules, midnight and 06:00 boundaries, missed checkout, cron-finalized checkout, ordering, later live conflicts, tenant/status policy and reports. Real transaction/concurrency tests are necessary; mocked tests cannot establish database atomicity.

Final deployment instructions must include application/config and consistent database backups, non-destructive explicit index creation, transaction verification, kiosk contract tests, feature gating, PM2 environment/restart steps, log checks and rollback. Retain the event ledger on rollback to avoid duplicate replay. No deployment or dependency installation has occurred.
