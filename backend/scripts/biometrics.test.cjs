const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
    const users = [
        { _id: '000000000000000000000001', adminId: 'tenant-a', role: 'Employee', status: 'Active', name: 'Alice', faceEnrolled: true, faceDescriptors: [[1]], fingerprintTemplate: 'template' },
        { _id: '000000000000000000000002', adminId: 'tenant-a', role: 'Employee', status: 'Active', name: 'Bob', faceEnrolled: false, faceDescriptors: [[2]], fingerprintTemplate: null },
        { _id: '000000000000000000000003', adminId: 'tenant-b', role: 'Employee', status: 'Active', faceEnrolled: true },
        { _id: '000000000000000000000004', adminId: 'tenant-a', role: 'Admin', status: 'Active', faceEnrolled: true },
        { _id: '000000000000000000000005', adminId: 'tenant-a', role: 'Employee', status: 'Deleted', faceEnrolled: true }
    ];
    let writes = 0;
    const matches = (query) => users.filter(user => user.adminId === query.adminId && !query.role.$nin.includes(user.role) && user.status !== query.status.$ne && (!query._id || query._id.$in.includes(user._id)));
    const model = {
        find(query) { return { select() { return this; }, sort() { return this; }, async lean() { return matches(query); } }; },
        async countDocuments(query) { return matches(query).length; },
        async updateMany(query, update) {
            writes++;
            const selected = matches(query);
            selected.forEach(user => Object.assign(user, update.$set));
            return { modifiedCount: selected.length };
        }
    };
    const filename = path.resolve(__dirname, '../controllers/biometricController.js');
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, require: () => model }, { filename });
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    return { users, res, controller: module.exports, writes: () => writes };
}

test('listing only returns tenant staff and enrollment flags, never templates', async () => {
    const f = fixture();
    await f.controller.getBiometricUsers({ adminId: 'tenant-a' }, f.res);
    assert.equal(f.res.body.length, 2);
    assert.equal(f.res.body[1].faceEnrolled, true);
    assert.equal(f.res.body[0].fingerprintEnrolled, true);
    assert.equal(f.res.body[1].fingerprintEnrolled, false);
    for (const user of f.res.body) {
        assert.ok(!('faceDescriptors' in user));
        assert.ok(!('fingerprintTemplate' in user));
    }
});

for (const type of ['face', 'fingerprint']) {
    test(`${type} deletion preserves the other biometric and unselected staff`, async () => {
        const f = fixture();
        await f.controller.removeBiometrics({ adminId: 'tenant-a', body: { type, userIds: [f.users[0]._id] } }, f.res);
        assert.equal(f.res.code, 200);
        if (type === 'face') {
            assert.equal(f.users[0].faceEnrolled, false);
            assert.equal(f.users[0].faceDescriptors.length, 0);
            assert.equal(f.users[0].fingerprintTemplate, 'template');
        } else {
            assert.equal(f.users[0].fingerprintTemplate, null);
            assert.equal(f.users[0].faceEnrolled, true);
        }
        assert.equal(f.users[1].faceDescriptors[0][0], 2);
        assert.equal(f.users[2].faceEnrolled, true);
    });
}

test('select all can delete biometric data for every eligible staff member', async () => {
    const f = fixture();
    await f.controller.removeBiometrics({ adminId: 'tenant-a', body: { type: 'face', userIds: f.users.slice(0, 2).map(user => user._id) } }, f.res);
    assert.equal(f.res.body.modifiedCount, 2);
    assert.ok(f.users.slice(0, 2).every(user => !user.faceEnrolled && !user.faceDescriptors.length));
    assert.ok(f.users.slice(2).every(user => user.faceEnrolled));
});

for (const index of [2, 3, 4]) {
    test(`rejects mixed selections containing inaccessible user ${index}`, async () => {
        const f = fixture();
        await f.controller.removeBiometrics({ adminId: 'tenant-a', body: { type: 'face', userIds: [f.users[0]._id, f.users[index]._id] } }, f.res);
        assert.equal(f.res.code, 404);
        assert.equal(f.writes(), 0);
        assert.equal(f.users[0].faceEnrolled, true);
    });
}

for (const body of [{ type: 'unknown', userIds: [] }, { type: 'face', userIds: [] }, { type: 'face', userIds: ['invalid'] }, { type: 'fingerprint' }]) {
    test(`rejects invalid deletion request ${JSON.stringify(body)}`, async () => {
        const f = fixture();
        await f.controller.removeBiometrics({ adminId: 'tenant-a', body }, f.res);
        assert.equal(f.res.code, 400);
        assert.equal(f.writes(), 0);
    });
}
