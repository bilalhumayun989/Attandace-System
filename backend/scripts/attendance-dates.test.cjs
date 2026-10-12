const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { addCalendarDays, getCalendarWeekday } = require('../utils/calendar');

const NOW = '2026-10-11T15:00:00+05:00';
function fixture(records = [], now = NOW) {
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
    const user = { _id: 'employee', adminId: 'tenant', status: 'Active', joinDate: '2026-10-08', offDays: [5] };
    let saved = 0;
    for (const record of records) record.save = async () => { saved++; };
    const matches = (r, q) => Object.entries(q).every(([key, value]) => {
        if (key === '$expr') return r.shifts?.at(-1)?.missed !== true;
        if (key === '$or') return value.some(condition => matches(r, condition));
        const actual = r[key];
        if (value && typeof value === 'object' && !(value instanceof Date)) {
            return Object.entries(value).every(([op, expected]) => {
                if (op === '$ne') return expected === null ? actual != null : actual !== expected;
                if (op === '$lt') return actual != null && (typeof expected === 'string' ? actual < expected : new Date(actual) < expected);
                if (op === '$lte') return actual <= expected;
                if (op === '$in') return expected.includes(actual);
                throw Error('Unsupported operator ' + op);
            });
        }
        return value === null ? actual == null : actual === value;
    });
    const chain = value => ({ select() { return this; }, sort() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
    const Attendance = {
        find: q => chain(records.filter(r => matches(r, q))),
        findOne: q => chain(records.find(r => matches(r, q)) || null),
        async insertMany(newRecords) { records.push(...newRecords); }
    };
    const User = { findById: async () => user };
    function load(relative) {
        const filename = path.resolve(__dirname, '..', relative);
        const realRequire = createRequire(filename);
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module, exports: module.exports, Date: ClockDate, console, process,
            require: name => {
                if (name === '../models/Attendance') return Attendance;
                if (name === '../models/User') return User;
                if (name === '../models/Payroll') return {};
                if (name === 'node-cron') return { schedule() {} };
                if (name === 'exceljs' || name === 'nodemailer') return {};
                if (name === '../utils/reportCron') return cron;
                return realRequire(name);
            }
        }, { filename });
        return module.exports;
    }
    const cron = load('utils/reportCron.js');
    const controller = load('controllers/attendanceController.js');
    return { user, records, cron, controller, saves: () => saved };
}

test('calendar arithmetic crosses month and leap-year boundaries', () => {
    assert.equal(addCalendarDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addCalendarDays('2026-01-01', -1), '2025-12-31');
    assert.equal(getCalendarWeekday('2026-10-09'), 5);
    assert.equal(getCalendarWeekday('2026-10-10'), 6);
});

for (const bulk of [false, true]) {
    test((bulk ? 'bulk' : 'single') + ' absence reconciliation uses Pakistan weekdays', async () => {
        const f = fixture();
        if (bulk) await f.controller.reconcileMultipleUsersAttendance([f.user]);
        else await f.controller.reconcileAttendance(f.user._id);
        assert.deepEqual(Array.from(f.records, r => r.date), ['2026-10-08', '2026-10-10']);
        assert.ok(f.records.every(r => r.status === 'Absent'));
    });
}

const missed = (overrides = {}) => ({ userId: 'employee', adminId: 'tenant', date: '2026-10-10', checkIn: new Date('2026-10-10T17:05:00+05:00'), checkOut: null, status: 'Present', duration: 0, shifts: [], ...overrides });
test('history finalizes yesterday without a checkout or a next-day duplicate', async () => {
    const f = fixture([missed()]);
    f.user.joinDate = '2026-10-10';
    await f.controller.reconcileAttendance(f.user._id);
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0].date, '2026-10-10');
    assert.equal(f.records[0].status, 'Absent');
    assert.equal(f.records[0].checkOut, null);
    assert.equal(f.records[0].shifts.at(-1).missed, true);
    await f.cron.runAutoCheckOut({ userId: 'employee' });
    assert.equal(f.saves(), 1);
});

test('expired shift is excluded from the next-day timer state', async () => {
    const f = fixture([missed()]);
    const res = { json(body) { this.body = body; }, status() { return this; } };
    await f.controller.getAttendanceStatus({ user: { _id: 'employee' } }, res);
    assert.equal(res.body, null);
    assert.equal(f.records[0].date, '2026-10-10');
    assert.equal(f.records[0].status, 'Absent');
});

test('earlier missed shift does not block expiry of a later open shift', async () => {
    const checkIn = new Date('2026-10-10T17:05:00+05:00');
    const f = fixture([missed({ shifts: [{ missed: true }, { checkIn, checkOut: null, missed: false }] })]);
    await f.cron.runAutoCheckOut({ userId: 'employee' });
    assert.equal(f.records[0].shifts.at(-1).missed, true);
    assert.equal(f.records[0].status, 'Absent');
});

test('completed work is preserved and other tenants and current-day shifts are untouched', async () => {
    const checkIn = new Date('2026-10-10T17:05:00+05:00');
    const f = fixture([
        missed({ duration: 60, shifts: [{ checkIn, checkOut: new Date('2026-10-10T12:00:00+05:00'), duration: 60 }, { checkIn, checkOut: null }] }),
        missed({ adminId: 'other' }),
        missed({ date: '2026-10-11', checkIn: new Date('2026-10-11T14:00:00+05:00') })
    ]);
    await f.cron.runAutoCheckOut({ adminId: 'tenant' });
    assert.equal(f.records[0].status, 'Present');
    assert.equal(f.records[0].duration, 60);
    assert.equal(f.records[0].shifts.at(-1).missed, true);
    assert.equal(f.records[1].shifts.length, 0);
    assert.equal(f.records[2].shifts.length, 0);
    assert.equal(f.saves(), 1);
});

test('a 5 PM missed checkout remains overnight then expires at 6 AM on its original date', async () => {
    const overnight = fixture([missed()], '2026-10-11T05:59:59+05:00');
    await overnight.cron.runAutoCheckOut({ userId: 'employee' });
    assert.equal(overnight.saves(), 0);
    assert.equal(overnight.records[0].status, 'Present');
    const morning = fixture([missed()], '2026-10-11T06:00:00+05:00');
    morning.user.joinDate = '2026-10-10';
    await morning.controller.reconcileAttendance('employee');
    assert.equal(morning.records.length, 1);
    assert.equal(morning.records[0].date, '2026-10-10');
    assert.equal(morning.records[0].status, 'Absent');
    assert.equal(morning.records[0].checkOut, null);
    assert.equal(morning.records[0].shifts.at(-1).missed, true);
});
