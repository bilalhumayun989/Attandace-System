const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const mongoose = require('mongoose');
const runtime = process.env.ATTENDANCE_TEST_TOOLS
    ? path.join(process.env.ATTENDANCE_TEST_TOOLS, 'node_modules/mongodb-memory-server')
    : 'mongodb-memory-server';
const { MongoMemoryReplSet } = require(runtime);
const Attendance = require('../models/Attendance');
const User = require('../models/User');

// This suite uses a disposable local replica set, never .env or the application's database.
const employee = new mongoose.Types.ObjectId('000000000000000000000001');
const tenant = new mongoose.Types.ObjectId('000000000000000000000002');
const scope = { userId: employee, adminId: tenant };
const time = value => new Date('2026-10-' + value + '+05:00');
let database;
test.before(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri(), { dbName: 'attendance_boundary_tests' });
    await Promise.all([Attendance.init(), User.init()]);
}, { timeout: 300000 });
test.after(async () => {
    await mongoose.disconnect();
    if (database) await database.stop();
});
test.beforeEach(async () => {
    await Attendance.deleteMany({});
    await User.deleteMany({});
    await User.create({ _id: employee, adminId: tenant, employeeId: 'NIGHT-1', name: 'Night staff',
        password: 'test-only', department: 'Test', joinDate: '2026-10-10', fingerprintTemplate: Buffer.alloc(400).toString('base64') });
});

function fixture(initial = '11T02:00:00') {
    let now = time(initial);
    const errors = [];
    class Clock extends Date {
        constructor(...args) { return new Date(...(args.length ? args : [now])); }
        static now() { return +now; }
    }
    let cron;
    function load(relative) {
        const filename = path.resolve(__dirname, '..', relative);
        const realRequire = createRequire(filename);
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module, exports: module.exports, Date: Clock, Buffer, __dirname: path.dirname(filename),
            process: { env: { HRMS_KIOSK_ADMIN_ID: String(tenant) } },
            console: { log() {}, error(...args) { errors.push(args); if (process.env.ATTENDANCE_TEST_DEBUG) console.error(...args); } },
            require(name) {
                if (name === 'node-cron') return { schedule() {} };
                if (name === 'exceljs' || name === 'nodemailer') return {};
                if (name === '../utils/reportCron') return cron;
                return realRequire(name);
            }
        }, { filename });
        return module.exports;
    }
    cron = load('utils/reportCron.js');
    const handler = () => load('routes/attendanceFingerprint.routes.js').stack
        .find(layer => layer.route?.path === '/fingerprint-checkin').route.stack.at(-1).handle;
    const first = handler(), second = handler(); // independent Node-process state, same real database
    let serial = 0;
    return {
        cron, errors, at(value) { now = time(value); },
        controller() { return load('controllers/attendanceController.js'); },
        async scan(body = {}, otherProcess = false) {
            const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
            await (otherProcess ? second : first)({ body: {
                userId: String(employee), clientId: 'test-client-' + String(++serial).padStart(12, '0'), ...body
            } }, response);
            return { code: response.code, ...response.body };
        },
        async expire() { await cron.runAutoCheckOut(scope, now); },
        async rows() { return Attendance.find(scope).sort({ date: 1 }).lean(); }
    };
}
const total = rows => rows.reduce((sum, row) => sum + row.duration, 0);
function sources(rows) {
    assert.ok(rows.every(row => row.status === 'Present' && row.shifts.every(shift => !shift.missed)));
    assert.equal(rows[0].shifts.at(-1).checkOutSource, 'boundary');
    assert.equal(rows[1].shifts.at(-1).checkInSource, 'boundary');
}

for (const offline of [false, true]) {
    test((offline ? 'offline' : 'online') + ': 02:00 IN / 15:00 OUT allocates 4h + 9h without synthetic scans', async () => {
        const f = fixture();
        if (offline) f.at('12T18:00:00');
        const input = offline ? { offline: true, scannedAt: time('11T02:00:00').toISOString() } : {};
        assert.equal((await f.scan(input)).action, 'checkin');
        if (!offline) f.at('11T15:00:00');
        const output = offline ? { offline: true, scannedAt: time('11T15:00:00').toISOString() } : {};
        const result = await f.scan(output);
        assert.equal(result.action, 'checkout');
        assert.equal(result.workedMinutes, 780);
        const rows = await f.rows();
        assert.deepEqual(rows.map(row => [row.date, row.duration]), [['2026-10-10', 240], ['2026-10-11', 540]]);
        assert.equal(rows.reduce((n, row) => n + row.clientIds.length, 0), 2);
        sources(rows);
        assert.equal(rows[1].checkOutSource, 'fingerprint');
    });
}

test('cron at 06:00 leaves a 12-hour overnight shift open', async () => {
    const f = fixture('10T18:00:00'); await f.scan(); f.at('11T06:00:00'); await f.expire();
    const rows = await f.rows();
    assert.equal(rows.length, 1); assert.equal(rows[0].checkOut, null);
    assert.equal(rows[0].shifts[0].missed, false); assert.equal(rows[0].duration, 0);
});

for (const checkout of ['11T05:59:59', '11T06:00:00', '11T06:00:01']) {
    test('night checkout at ' + checkout + ' stays a checkout', async () => {
        const f = fixture('10T18:00:00'); await f.scan(); f.at(checkout);
        assert.equal((await f.scan()).action, 'checkout');
        const rows = await f.rows();
        assert.equal(total(rows), Math.floor((time(checkout) - time('10T18:00:00')) / 60000));
        assert.ok(rows.every(row => row.checkOut && row.shifts.every(shift => !shift.missed)));
    });
}

for (const cutoff of ['11T14:00:00', '11T17:00:00']) {
    test('20-hour automatic closure is exact and idempotent when cron runs at ' + cutoff, async () => {
        const f = fixture('10T18:00:00'); await f.scan(); f.at(cutoff); await f.expire(); await f.expire();
        const rows = await f.rows();
        assert.deepEqual(rows.map(row => row.duration), [720, 480]);
        assert.equal(+rows[1].checkOut, +time('11T14:00:00'));
        assert.equal(rows[1].checkOutSource, 'automatic');
        assert.equal(rows[1].shifts[0].checkOutSource, 'automatic');
        assert.equal(rows.reduce((n, row) => n + (row.clientIds?.length || 0), 0), 1);
        sources(rows);
    });
}

test('20-hour auto-closure without crossing 06:00 uses one workday', async () => {
    const f = fixture('10T07:00:00'); await f.scan(); f.at('11T03:00:00'); await f.expire();
    const rows = await f.rows(); assert.equal(rows.length, 1); assert.equal(total(rows), 1200);
    assert.equal(rows[0].checkOutSource, 'automatic'); assert.equal(+rows[0].checkOut, +time('11T03:00:00'));
});

test('a scan at the 20-hour cutoff cannot change the automatic OUT into a fingerprint OUT', async () => {
    const f = fixture('10T18:00:00'); await f.scan(); f.at('11T14:00:00');
    assert.equal((await f.scan()).action, 'too_soon');
    assert.equal((await f.rows())[1].checkOutSource, 'automatic');
});

test('30-minute minimum is preserved across 06:00', async () => {
    const f = fixture('11T05:50:00'); await f.scan(); f.at('11T06:00:00');
    assert.equal((await f.scan()).action, 'too_soon');
    assert.equal((await f.rows()).length, 1); f.at('11T06:20:00');
    assert.equal((await f.scan()).action, 'checkout');
    assert.deepEqual((await f.rows()).map(row => row.duration), [10, 20]);
});

test('10-minute recheck-in cooldown survives the workday boundary', async () => {
    const f = fixture(); await f.scan(); f.at('11T05:59:00'); await f.scan(); f.at('11T06:01:00');
    const result = await f.scan(); assert.equal(result.action, 'too_soon'); assert.equal(result.retryAfterSeconds, 480);
    assert.equal((await f.rows()).length, 1); f.at('11T06:09:00');
    assert.equal((await f.scan()).action, 'checkin');
});

test('completed sessions and markedByFace survive a later cross-day session', async () => {
    const f = fixture(); await f.scan(); f.at('11T03:00:00'); await f.scan(); f.at('11T03:10:00'); await f.scan();
    await Attendance.updateOne(scope, { $set: { markedByFace: true } });
    f.at('11T15:00:00'); assert.equal((await f.scan()).action, 'checkout');
    const rows = await f.rows(); assert.deepEqual(rows.map(row => row.duration), [230, 540]);
    assert.equal(rows[0].shifts.length, 2); assert.equal(rows[0].shifts[0].duration, 60);
    assert.equal(rows[0].markedByFace, true);
});

for (const actualOut of ['11T05:00:00', '11T15:00:00']) {
    test('delayed offline OUT at ' + actualOut + ' replaces prior cron auto-closure, and retries are duplicates', async () => {
        const f = fixture(); await f.scan(); f.at('11T22:00:00'); await f.expire();
        assert.equal(total(await f.rows()), 1200); f.at('12T18:00:00');
        const replay = { offline: true, scannedAt: time(actualOut).toISOString(), clientId: 'offline-checkout-retry-12345' };
        assert.equal((await f.scan(replay)).action, 'checkout');
        const rows = await f.rows();
        assert.equal(total(rows), (time(actualOut) - time('11T02:00:00')) / 60000);
        assert.equal(rows.at(-1).checkOutSource, 'fingerprint');
        assert.equal(rows.length, actualOut.includes('05:') ? 1 : 2);
        assert.equal((await f.scan(replay)).action, 'duplicate');
        assert.deepEqual(await f.rows(), rows);
    });
}

test('out-of-order offline scan cannot overwrite a newer real session', async () => {
    const f = fixture(); await f.scan(); f.at('11T15:00:00'); await f.scan(); f.at('11T15:10:00'); await f.scan();
    const before = await f.rows(); f.at('12T18:00:00');
    const result = await f.scan({ offline: true, scannedAt: time('11T14:00:00').toISOString() });
    assert.equal(result.code, 409); assert.equal(result.action, 'rejected'); assert.deepEqual(await f.rows(), before);
});

function failSaveOn(date) {
    const save = Attendance.prototype.save;
    Attendance.prototype.save = async function (...args) {
        if (this.date === date) throw new Error('Injected failure between workday saves');
        return save.apply(this, args);
    };
    return () => { Attendance.prototype.save = save; };
}

test('failure between manual split writes rolls back both days and clientId; retry succeeds', async () => {
    const f = fixture(); await f.scan(); const before = await f.rows(); f.at('11T15:00:00');
    const restore = failSaveOn('2026-10-11');
    const body = { clientId: 'manual-failure-retry-12345' };
    try { assert.equal((await f.scan(body)).code, 500); } finally { restore(); }
    assert.deepEqual(await f.rows(), before);
    assert.equal((await f.scan(body)).action, 'checkout');
    assert.equal((await f.scan(body)).action, 'duplicate'); assert.equal(total(await f.rows()), 780);
});

test('failure between automatic split writes rolls back; next cron run recovers', async () => {
    const f = fixture(); await f.scan(); const before = await f.rows(); f.at('11T22:00:00');
    const restore = failSaveOn('2026-10-11');
    try { await assert.rejects(f.expire(), /Injected failure/); } finally { restore(); }
    assert.deepEqual(await f.rows(), before); await f.expire(); assert.equal(total(await f.rows()), 1200);
});

test('commit failure cannot send a successful response or lose the queued scan', async () => {
    const f = fixture(); await f.scan(); const before = await f.rows(); f.at('11T15:00:00');
    const transaction = Attendance.db.transaction;
    Attendance.db.transaction = function (work, options) {
        return transaction.call(this, async session => { await work(session); throw new Error('Injected before commit'); }, options);
    };
    try { assert.equal((await f.scan()).code, 500); } finally { Attendance.db.transaction = transaction; }
    assert.deepEqual(await f.rows(), before);
});

test('concurrent duplicate checkouts from independent processes commit once', async () => {
    const f = fixture(); await f.scan(); f.at('11T15:00:00');
    const results = await Promise.all([f.scan({ clientId: 'concurrent-same-scan-12345' }), f.scan({ clientId: 'concurrent-same-scan-12345' }, true)]);
    assert.deepEqual(results.map(result => result.action).sort(), ['checkout', 'duplicate']);
    assert.equal(total(await f.rows()), 780);
});

test('concurrent distinct scans cannot create a second open shift', async () => {
    const f = fixture();
    const results = await Promise.all([f.scan(), f.scan({}, true)]);
    assert.deepEqual(results.map(result => result.action).sort(), ['checkin', 'too_soon']);
    const rows = await f.rows(); assert.equal(rows.length, 1); assert.equal(rows[0].shifts.length, 1);
});

test('concurrent first scans on either side of 06:00 cannot create two open workdays', async () => {
    const before = fixture('11T05:59:59'), after = fixture('11T06:00:00');
    const results = await Promise.all([before.scan({ clientId: 'before-boundary-scan-12345' }), after.scan({ clientId: 'after-boundary-scan-12345' })]);
    assert.equal(results.filter(result => result.action === 'checkin').length, 1);
    const rows = await before.rows(); assert.equal(rows.filter(row => !row.checkOut).length, 1);
});

test('concurrent cron and delayed offline checkout produce the real checkout exactly once', async () => {
    const cron = fixture('10T18:00:00'); await cron.scan(); cron.at('11T14:00:00');
    const kiosk = fixture('12T18:00:00');
    const [, result] = await Promise.all([cron.expire(), kiosk.scan({ offline: true,
        scannedAt: time('11T06:01:00').toISOString(), clientId: 'cron-scan-race-12345678' })]);
    assert.equal(result.action, 'checkout'); const rows = await cron.rows();
    assert.equal(total(rows), 721); assert.equal(rows.at(-1).checkOutSource, 'fingerprint');
});

test('two cron processes cannot double-count an expired shift', async () => {
    const first = fixture(); await first.scan(); first.at('11T22:00:00'); const second = fixture('11T22:00:00');
    await Promise.all([first.expire(), second.expire()]); const rows = await first.rows();
    assert.equal(total(rows), 1200); assert.equal(rows.length, 2); assert.ok(rows.every(row => row.shifts.length === 1));
});

test('automatic checkout remains tenant-scoped', async () => {
    const f = fixture(); await f.scan(); f.at('11T22:00:00');
    await f.cron.runAutoCheckOut({ userId: employee, adminId: new mongoose.Types.ObjectId() }, time('11T22:00:00'));
    assert.equal((await f.rows())[0].checkOut, null);
});

test('cron grace period protects records updated during synchronization', async () => {
    const f = fixture(); await f.scan(); f.at('11T22:00:00');
    await Attendance.collection.updateMany({}, { $set: { updatedAt: time('11T21:59:00') } });
    await f.cron.runAutoCheckOut(scope); assert.equal((await f.rows())[0].checkOut, null);
    await Attendance.collection.updateMany({}, { $set: { updatedAt: time('11T21:49:00') } });
    await f.cron.runAutoCheckOut(scope); assert.equal(total(await f.rows()), 1200);
});

test('stale attendance saves cannot overwrite a committed fingerprint transaction', async () => {
    const f = fixture(); await f.scan(); const stale = await Attendance.findOne(scope);
    f.at('11T15:00:00'); await f.scan(); stale.status = 'Absent';
    await assert.rejects(stale.save(), error => error.name === 'VersionError');
    assert.equal(total(await f.rows()), 780);
});


test('earlier missed sessions do not block automatic closure of a later open session', async () => {
    const f = fixture(); await f.scan();
    await Attendance.updateOne(scope, { $push: { shifts: { $each: [{ checkIn: time('11T00:00:00'), checkOut: null, duration: 0, missed: true }], $position: 0 } } });
    f.at('11T22:00:00'); await f.expire(); const rows = await f.rows();
    assert.equal(total(rows), 1200); assert.equal(rows[0].shifts[0].missed, true);
    assert.equal(rows[0].shifts[1].missed, false); assert.equal(rows[0].status, 'Present');
});

test('legacy open attendance without shifts still closes after 20 hours', async () => {
    const f = fixture();
    await Attendance.create({ ...scope, date: '2026-10-10', checkIn: time('11T02:00:00'), checkOut: null, shifts: [] });
    f.at('11T22:00:00'); await f.expire();
    const rows = await f.rows(); assert.equal(total(rows), 1200); assert.equal(rows.at(-1).checkOutSource, 'automatic');
});

test('expired offline scans and invalid client ids are rejected without writes', async () => {
    const f = fixture('19T12:00:00');
    assert.equal((await f.scan({ offline: true, scannedAt: time('01T02:00:00').toISOString() })).code, 400);
    assert.equal((await f.scan({ clientId: 'bad' })).code, 400);
    assert.equal((await f.rows()).length, 0);
});

test('a future offline scan over the clock tolerance is rejected', async () => {
    const f = fixture();
    assert.equal((await f.scan({ offline: true, scannedAt: time('11T03:00:00').toISOString() })).code, 400);
    assert.equal((await f.rows()).length, 0);
});


test('too-early offline OUT does not undo an already committed automatic closure', async () => {
    const f = fixture(); await f.scan(); f.at('11T22:00:00'); await f.expire(); const before = await f.rows();
    f.at('12T18:00:00');
    const result = await f.scan({ offline: true, scannedAt: time('11T02:10:00').toISOString() });
    assert.equal(result.action, 'too_soon'); assert.equal(result.retryAfterSeconds, 1200);
    assert.deepEqual(await f.rows(), before);
});

test('offline correction failure rolls back the automatic allocation and can be replayed safely', async () => {
    const f = fixture(); await f.scan(); f.at('11T22:00:00'); await f.expire(); const before = await f.rows();
    f.at('12T18:00:00'); const restore = failSaveOn('2026-10-11');
    const replay = { offline: true, scannedAt: time('11T15:00:00').toISOString(), clientId: 'offline-rollback-retry-12345' };
    try { assert.equal((await f.scan(replay)).code, 500); } finally { restore(); }
    assert.deepEqual(await f.rows(), before);
    assert.equal((await f.scan(replay)).action, 'checkout'); assert.equal(total(await f.rows()), 780);
});


test('status and history reconciliation keep a night shift open after 06:00', async () => {
    const f = fixture('10T18:00:00'); await f.scan(); f.at('11T06:01:00');
    const controller = f.controller(); await controller.reconcileAttendance(employee);
    const res = { json(body) { this.body = body; }, status() { return this; } };
    await controller.getAttendanceStatus({ user: { _id: employee } }, res);
    assert.equal(+res.body.checkIn, +time('10T18:00:00')); assert.equal(res.body.checkOut, null);
    assert.equal((await f.rows()).length, 1); assert.equal((await f.rows())[0].status, 'Present');
});

test('expired shifts no longer appear as open in the status endpoint', async () => {
    const f = fixture('10T18:00:00'); await f.scan(); f.at('11T14:01:00');
    await Attendance.collection.updateMany({}, { $set: { updatedAt: time('11T13:00:00') } });
    const res = { json(body) { this.body = body; }, status() { return this; } };
    await f.controller().getAttendanceStatus({ user: { _id: employee } }, res);
    assert.equal(+res.body.checkOut, +time('11T14:00:00')); assert.equal(res.body.checkOutSource, 'automatic');
});
