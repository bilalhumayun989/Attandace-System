const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ExcelJS = require('exceljs');
const { formatInTimeZone } = require('date-fns-tz');

const stamp = time => new Date('2026-10-11T' + time + ':00+05:00');
const first = { checkIn: stamp('13:00'), checkOut: stamp('13:07'), duration: 7 };
const second = { checkIn: stamp('20:49'), checkOut: stamp('21:30'), duration: 41 };
const record = (id, shifts, extra = {}) => ({
    adminId: 'tenant', date: '2026-10-11', userId: { employeeId: id, name: id, adminId: 'tenant' },
    checkIn: shifts.at(-1)?.checkIn || stamp('13:00'), checkOut: shifts.at(-1)?.checkOut || null,
    duration: shifts.reduce((total, s) => total + (s.missed ? 0 : s.duration || 0), 0),
    status: 'Present', shifts, ...extra
});
const records = [
    record('EMP-108', [first, { checkIn: stamp('20:49'), checkOut: null, missed: true }]),
    record('second-complete', [first, second]),
    record('third-missed', [first, second, { checkIn: stamp('22:00'), checkOut: null, missed: true }]),
    record('still-open', [first, { checkIn: stamp('20:49'), checkOut: null }]),
    record('none-complete', [{ checkIn: stamp('20:49'), checkOut: null, missed: true }], { status: 'Absent' }),
    record('legacy', [], { checkIn: first.checkIn, checkOut: first.checkOut, duration: 7 })
];
const expected = [
    ['EMP-108', '01:00 PM', '01:07 PM', '0h 7m'],
    ['second-complete', '08:49 PM', '09:30 PM', '0h 48m'],
    ['third-missed', '08:49 PM', '09:30 PM', '0h 48m'],
    ['still-open', '01:00 PM', '01:07 PM', '0h 7m'],
    ['none-complete', '08:49 PM', '-', '-'],
    ['legacy', '01:00 PM', '01:07 PM', '0h 7m']
];
const formatTime = d => formatInTimeZone(d, 'Asia/Karachi', 'hh:mm a');
const formatDuration = n => n ? Math.floor(n / 60) + 'h ' + n % 60 + 'm' : '-';

test('downloaded CSV pairs times from the latest completed shift and keeps daily totals', () => {
    const filename = path.resolve(__dirname, '../../hrms/src/pages/admin/AttendanceTracker.jsx');
    const source = fs.readFileSync(filename, 'utf8');
    const start = source.indexOf('    const handleExport = () => {');
    const end = source.indexOf('    const handleUpdateStatus =', start);
    assert.ok(start >= 0 && end > start);
    let csv;
    const before = records.map(r => Array.from(r.shifts, s => s.checkIn));
    class FakeBlob { constructor(parts) { csv = parts.join(''); } }
    const link = { setAttribute() {}, click() {}, style: {} };
    vm.runInNewContext(source.slice(start, end) + '\nhandleExport();', {
        filteredAttendance: records, format12h: formatTime, calculateHours: formatDuration,
        Blob: FakeBlob, URL: { createObjectURL() { return 'test'; } },
        document: { createElement() { return link; }, body: { appendChild() {}, removeChild() {} } },
        selectedEmployeeId: 'All', filterMonth: '10', filterYear: '2026'
    });
    const rows = csv.split('\n').slice(1).map(line => line.split(',').map(value => value.replaceAll('"', '')));
    assert.deepEqual(rows.map(r => [r[1], r[3], r[4], r[5]]), expected);
    assert.deepEqual(records.map(r => Array.from(r.shifts, s => s.checkIn)), before);
});

test('emailed XLSX uses the same completed-shift times without sending real email', async () => {
    const filename = path.resolve(__dirname, '../utils/reportCron.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    const emails = [];
    class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-12T05:00:00+05:00'])); } }
    const admin = { _id: 'tenant', adminId: 'tenant', name: 'Admin', email: 'test@example.invalid' };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, Date: FixedDate, console,
        process: { env: { EMAIL_USER: 'test@example.invalid', EMAIL_PASS: 'dummy-for-test' } },
        require: name => {
            if (name === '../models/Attendance') return { find() { return { populate: async () => records }; } };
            if (name === '../models/User') return { findOne: async () => admin, find: async () => [] };
            if (name === '../models/Payroll') return {};
            if (name === 'node-cron') return { schedule() {} };
            if (name === 'nodemailer') return { createTransport() { return { async sendMail(email) { emails.push(email); } }; } };
            return realRequire(name);
        }
    }, { filename });
    const result = await module.exports.sendDailyReport('tenant');
    assert.equal(result.sentCount, 1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(emails[0].attachments[0].content);
    const rows = [];
    workbook.worksheets[0].eachRow((row, index) => {
        if (index > 1) rows.push([row.getCell(1).value, row.getCell(4).value, row.getCell(5).value, row.getCell(6).value]);
    });
    assert.deepEqual(rows.sort((a, b) => a[0].localeCompare(b[0])), [...expected].sort((a, b) => a[0].localeCompare(b[0])));
});
