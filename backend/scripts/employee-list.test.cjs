const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const User = require('../models/User');
const projectionFields = ['password', 'faceDescriptors', 'fingerprintTemplate', 'verificationToken', 'resetPasswordToken', 'resetPasswordExpire'];

function fixture() {
    const users = Array.from({ length: 100 }, (_, index) => new User({
        employeeId: 'EMP-' + String(index + 1).padStart(3, '0'), name: 'Employee ' + index,
        role: 'Employee', adminId: '000000000000000000000001', department: 'Production',
        salary: 30000, offDays: [5], faceEnrolled: true, joinDate: '2026-10-01',
        status: index === 99 ? 'Deleted' : 'Active', password: 'hash',
        faceDescriptors: Array.from({ length: 5 }, () => Array.from({ length: 128 }, (_, i) => Math.sin(i))),
        fingerprintTemplate: 'template'.repeat(200), verificationToken: 'verification',
        resetPasswordToken: 'reset', resetPasswordExpire: new Date(),
        createdAt: new Date(2026, 9, index + 1)
    }).toObject());
    users.push({ ...users[0], employeeId: 'OTHER-TENANT', adminId: '000000000000000000000002' });
    let executedQuery;
    const model = {
        find(filter) {
            const query = User.find(filter);
            query.exec = async () => {
                // Real execution normalizes string exclusion projections before the database call.
                query._applyPaths();
                executedQuery = query;
                return users.filter(u => String(u.adminId) === filter.adminId && !filter.role.$nin.includes(u.role) && (!filter.status || u.status !== filter.status.$ne))
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map(u => Object.fromEntries(Object.entries(u).filter(([key]) => query.projection()?.[key] !== 0)));
            };
            return query;
        }
    };
    const filename = path.resolve(__dirname, '../controllers/userController.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, console, process,
        require: name => {
            if (name === '../models/User') return model;
            if (name === 'nodemailer') return { createTransport() { return {}; } };
            return realRequire(name);
        }
    }, { filename });
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    return { users, controller: module.exports, res, query: () => executedQuery };
}

test('staff responses omit large fields and preserve editing and enrollment data', async () => {
    const f = fixture();
    await f.controller.getEmployees({ adminId: '000000000000000000000001', query: {} }, f.res);
    assert.equal(f.res.body.length, 99);
    assert.ok(f.res.body.every(user => user.status === 'Active'));
    for (const field of projectionFields) assert.ok(f.res.body.every(user => !(field in user)), field);
    const user = f.res.body[0];
    assert.equal(user.faceEnrolled, true);
    assert.equal(user.salary, 30000);
    assert.equal(user.department, 'Production');
    assert.deepEqual(user.offDays, [5]);
    assert.equal(user.joinDate, '2026-10-01');
    assert.equal(f.query().mongooseOptions().lean, true);
    assert.deepEqual(f.query().getOptions().sort, { createdAt: -1 });
    const before = Buffer.byteLength(JSON.stringify(f.users.slice(0, 99)));
    const after = Buffer.byteLength(JSON.stringify(f.res.body));
    assert.ok(after < before * 0.1, 'Representative biometric payload should shrink by at least 90%');
    console.log('Representative staff payload: ' + before + ' bytes -> ' + after + ' bytes');
});

test('management can still list deleted staff for restoration', async () => {
    const f = fixture();
    await f.controller.getEmployees({ adminId: '000000000000000000000001', query: { includeDeleted: 'true' } }, f.res);
    assert.equal(f.res.body.length, 100);
    assert.ok(f.res.body.some(user => user.status === 'Deleted'));
    assert.ok(f.res.body.every(user => user.employeeId !== 'OTHER-TENANT'));
});

test('schema has an index matching tenant staff-list ordering', () => {
    assert.ok(User.schema.indexes().some(([keys]) => keys.adminId === 1 && keys.createdAt === -1));
});


function renderList({ search = '', page = 1, employees = null } = {}) {
    const filename = path.resolve(__dirname, '../../hrms/src/pages/admin/EmployeeList.jsx');
    const hrmsRequire = createRequire(path.resolve(__dirname, '../../hrms/package.json'));
    const React = hrmsRequire('react');
    const { renderToStaticMarkup } = hrmsRequire('react-dom/server');
    const { transformSync } = hrmsRequire('esbuild');
    employees = employees || Array.from({ length: 125 }, (_, index) => ({
        _id: String(index), name: 'Employee ' + (index + 1), employeeId: 'EMP-' + String(index + 1).padStart(3, '0'),
        role: 'Employee', department: 'Production', offDays: [5], status: 'Active', faceEnrolled: true
    }));
    let firstEmptyString = true;
    const hooks = { ...React,
        useState(initial) {
            if (Array.isArray(initial)) return [employees, () => {}];
            if (initial === '') {
                const value = firstEmptyString ? search : '';
                firstEmptyString = false;
                return [value, () => {}];
            }
            if (initial === 1) return [page, () => {}];
            return [initial, () => {}];
        },
        useEffect() {}, useMemo(fn) { return fn(); }
    };
    const module = { exports: {} };
    const simple = tag => ({ children, className, disabled }) => React.createElement(tag, { className, disabled }, children);
    const compiled = transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'transform' }).code;
    vm.runInNewContext(compiled, {
        module, exports: module.exports, console,
        require(name) {
            if (name === 'react') return hooks;
            if (name === 'react-router-dom') return { useNavigate: () => () => {} };
            if (name === '../../config') return { API_BASE_URL: '/api' };
            if (name.includes('AuthContext')) return { useAuth: () => ({ adminUser: { role: 'Admin' } }) };
            if (name.includes('PermissionsContext')) return { usePermissions: () => ({ can: () => true }) };
            if (name.includes('/Modal')) return { Modal: ({ isOpen, children }) => isOpen ? React.createElement('div', null, children) : null };
            if (name === 'lucide-react') return new Proxy({}, { get: () => () => React.createElement('svg') });
            if (name.includes('/Button')) return { Button: simple('button') };
            if (name.includes('/Input')) return { Input: simple('input') };
            if (name.includes('/Badge')) return { Badge: simple('span') };
            if (name.includes('/Card')) return { Card: simple('div'), CardContent: simple('div'), CardDescription: simple('div'), CardHeader: simple('div'), CardTitle: simple('div') };
            throw Error('Unexpected import: ' + name);
        }
    }, { filename });
    return renderToStaticMarkup(React.createElement(module.exports.default));
}

test('employee list initially renders only 50 of 125 staff', () => {
    const html = renderList();
    assert.equal((html.match(/<tr class=/g) || []).length, 50);
    assert.ok(html.includes('EMP-001'));
    assert.ok(!html.includes('EMP-051'));
    assert.ok(html.includes('of 125 employees'));
});

test('last page is clamped after the employee count changes', () => {
    const html = renderList({ page: 9 });
    assert.equal((html.match(/<tr class=/g) || []).length, 25);
    assert.ok(html.includes('EMP-125'));
    assert.ok(!html.includes('EMP-100'));
});

test('search includes employees beyond the first page', () => {
    const html = renderList({ search: 'EMP-108', page: 3 });
    assert.equal((html.match(/<tr class=/g) || []).length, 1);
    assert.ok(html.includes('EMP-108'));
    assert.ok(!html.includes('EMP-001'));
});
