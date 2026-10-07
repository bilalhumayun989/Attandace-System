const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture() {
    const users = [
        { _id: 'active', name: 'Active', status: 'Active', role: 'Employee', adminId: 'tenant', joinDate: '2099-01-01' },
        { _id: 'deleted', name: 'Deleted', status: 'Deleted', role: 'Employee', adminId: 'tenant', joinDate: '2099-01-01' },
        { _id: 'inactive', name: 'Inactive', status: 'Inactive', role: 'Employee', adminId: 'tenant', joinDate: '2099-01-01' },
        { _id: 'other', status: 'Active', role: 'Employee', adminId: 'other-tenant', joinDate: '2099-01-01' }
    ];
    const records = users.map(u => ({ _id: `${u._id}-record`, userId: u._id, adminId: u.adminId, date: '2026-10-01', month: '2026-10', status: 'Absent' }));
    records.push({ _id: 'orphan', userId: 'missing', adminId: 'tenant' });
    const matches = (value, query) => Object.entries(query).every(([key, expected]) => {
        const actual = value[key];
        if (expected && typeof expected === 'object') {
            if ('$ne' in expected) return actual !== expected.$ne;
            if ('$nin' in expected) return !expected.$nin.includes(actual);
        }
        return actual === expected;
    });
    const chain = value => ({
        sort() { return this; }, select() { return this; }, lean() { return this; },
        populate(options) {
            if (typeof options === 'object') value = value.map(r => ({ ...r, userId: users.find(u => u._id === r.userId && matches(u, options.match)) || null }));
            return this;
        },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
    });
    let recordReads = 0;
    const User = {
        find: q => chain(users.filter(u => matches(u, q))),
        findOne: q => chain(users.find(u => matches(u, q)) || null),
        findById: id => chain(users.find(u => u._id === id) || null)
    };
    const Records = { find(q) { recordReads++; return chain(records.filter(r => matches(r, q))); } };
    function load(relative) {
        const filename = path.resolve(__dirname, '..', relative);
        const realRequire = createRequire(filename);
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module, exports: module.exports, console, process, Date,
            require: name => {
                if (name === '../models/User') return User;
                if (['../models/Attendance', '../models/Payroll', '../models/Expense'].includes(name)) return Records;
                if (name === '../utils/reportCron') return { sendDailyReport() {} };
                if (name === './attendanceController') return load('controllers/attendanceController.js');
                if (name === './payrollController') return load('controllers/payrollController.js');
                return realRequire(name);
            }
        }, { filename });
        return module.exports;
    }
    const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    return { users, load, response, reads: () => recordReads };
}

for (const [file, handler, extra] of [
    ['controllers/attendanceController.js', 'getAllAttendance', {}],
    ['controllers/payrollController.js', 'getPayrolls', { query: {} }],
    ['controllers/expenseController.js', 'getExpenses', { query: { month: '2026-10' } }]
]) {
    test(`${handler} hides existing deleted records and shows them after restoration`, async () => {
        const f = fixture();
        const controller = f.load(file);
        const req = { adminId: 'tenant', ...extra };
        let res = f.response();
        await controller[handler](req, res);
        assert.equal(res.code, 200);
        assert.deepEqual(Array.from(res.body, r => r._id).sort(), ['active-record', 'inactive-record']);
        f.users[1].status = 'Active';
        res = f.response();
        await controller[handler](req, res);
        assert.deepEqual(Array.from(res.body, r => r._id).sort(), ['active-record', 'deleted-record', 'inactive-record']);
    });
}

test('deleted users do not trigger absence reconciliation', async () => {
    const f = fixture();
    const controller = f.load('controllers/attendanceController.js');
    await controller.reconcileAttendance('deleted');
    await controller.reconcileMultipleUsersAttendance([f.users[1]]);
    assert.equal(f.reads(), 0);
});

test('specific deleted-user attendance history is unavailable until restored', async () => {
    const f = fixture();
    const controller = f.load('controllers/attendanceController.js');
    const req = { adminId: 'tenant', params: { userId: 'deleted' } };
    let res = f.response();
    await controller.getUserAttendanceHistory(req, res);
    assert.equal(res.code, 404);
    assert.equal(f.reads(), 0);
    f.users[1].status = 'Active';
    res = f.response();
    await controller.getUserAttendanceHistory(req, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.length, 1);
});

test('employee lists hide deleted staff by default and allow restoration listing', async () => {
    const f = fixture();
    const controller = f.load('controllers/userController.js');
    let res = f.response();
    await controller.getEmployees({ adminId: 'tenant', query: {} }, res);
    assert.deepEqual(Array.from(res.body, u => u._id).sort(), ['active', 'inactive']);
    res = f.response();
    await controller.getEmployees({ adminId: 'tenant', query: { includeDeleted: 'true' } }, res);
    assert.deepEqual(Array.from(res.body, u => u._id).sort(), ['active', 'deleted', 'inactive']);
});

test('leave filters exclude deleted employees', async () => {
    const f = fixture();
    const res = f.response();
    await f.load('controllers/leaveController.js').getFilteredEmployees({ adminId: 'tenant', body: {} }, res);
    assert.deepEqual(Array.from(res.body, u => u._id).sort(), ['active', 'inactive']);
});


test('payroll generation skips deleted employees entirely', async () => {
    const f = fixture();
    f.users.forEach(user => { user.status = 'Deleted'; });
    const result = await f.load('controllers/payrollController.js').generatePayrollService('tenant', '2026-09', 15);
    assert.equal(result.length, 0);
    assert.equal(f.reads(), 0);
});

test('deleted employees cannot receive custom attendance or expense summaries', async () => {
    const f = fixture();
    let res = f.response();
    await f.load('controllers/attendanceController.js').addCustomAttendance({
        adminId: 'tenant', body: { userId: 'deleted', date: '2026-10-01', checkIn: '09:00' }
    }, res);
    assert.equal(res.code, 404);
    res = f.response();
    await f.load('controllers/expenseController.js').getEmployeeSummary({
        adminId: 'tenant', params: { userId: 'deleted' }, query: { month: '2026-10' }
    }, res);
    assert.equal(res.code, 404);
    assert.equal(f.reads(), 0);
});


test('existing sessions are rejected while an employee is deleted and work after restoration', async () => {
    const f = fixture();
    const jwt = createRequire(path.resolve(__dirname, '../package.json'))('jsonwebtoken');
    const token = jwt.sign({ id: 'deleted' }, process.env.JWT_SECRET || 'secret123');
    const req = { headers: { authorization: `Bearer ${token}` } };
    const protect = f.load('middleware/authMiddleware.js').protect;
    let nextCalls = 0;
    let res = f.response();
    await protect(req, res, () => { nextCalls++; });
    assert.equal(res.code, 401);
    assert.equal(nextCalls, 0);
    f.users[1].status = 'Active';
    res = f.response();
    await protect(req, res, () => { nextCalls++; });
    assert.equal(nextCalls, 1);
    assert.equal(req.adminId, 'tenant');
});
