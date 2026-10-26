require('dotenv').config();
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');

const applyChanges = process.argv.includes('--apply');

const migrateSession = async ({ userId, adminId, sessionStart }) => {
    const records = await Attendance.find({ userId, adminId, $or: [
        { 'shifts.sessionStart': sessionStart },
        { 'shifts.checkIn': sessionStart },
        { checkIn: sessionStart, checkOutSource: 'automatic' }
    ] });
    const affected = records.filter(record => record.shifts.some(shift =>
        +(shift.sessionStart || shift.checkIn) === +sessionStart &&
        (shift.checkOutSource === 'automatic' || shift.checkOutSource === 'boundary')
    ));
    if (!affected.length) return false;

    const original = affected.find(record => record.shifts.some(shift =>
        +(shift.sessionStart || shift.checkIn) === +sessionStart && +shift.checkIn === +sessionStart
    ));
    if (!original) return false;

    const changes = [];
    for (const record of affected) {
        const retained = record.shifts.filter(shift =>
            !(+(shift.sessionStart || shift.checkIn) === +sessionStart &&
                (shift.checkOutSource === 'automatic' || shift.checkOutSource === 'boundary'))
        );

        if (record === original) {
            retained.push({
                checkIn: sessionStart,
                checkOut: null,
                duration: 0,
                missed: true,
                sessionStart,
                checkInSource: original.checkInSource
            });
            record.shifts = retained;
            record.checkIn = sessionStart;
            record.checkOut = null;
            record.checkOutSource = undefined;
            record.status = 'Absent';
            record.duration = retained.reduce((total, shift) => total + (shift.missed ? 0 : shift.duration || 0), 0);
            record.isCheckingOut = false;
            changes.push(record);
        } else if (!retained.length && record.checkInSource === 'boundary') {
            changes.push(record);
        } else {
            record.shifts = retained;
            const last = retained[retained.length - 1];
            record.checkIn = last.checkIn;
            record.checkOut = last.checkOut || null;
            record.checkInSource = last.checkInSource;
            record.checkOutSource = last.checkOutSource;
            record.duration = retained.reduce((total, shift) => total + (shift.missed ? 0 : shift.duration || 0), 0);
            changes.push(record);
        }
    }

    if (applyChanges) {
        await mongoose.connection.transaction(async session => {
            for (const record of changes) {
                if (record !== original && !record.shifts.length && record.checkInSource === 'boundary') {
                    await Attendance.deleteOne({ _id: record._id }, { session });
                } else {
                    await record.save({ session });
                }
            }
        });
    }

    console.log(`${applyChanges ? 'Migrated' : 'Would migrate'} user ${userId} session ${sessionStart.toISOString()} (${changes.length} attendance records)`);
    return true;
};

const run = async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing from the environment.');
    await mongoose.connect(process.env.MONGO_URI);

    const records = await Attendance.find({
        $or: [
            { 'shifts.checkOutSource': 'automatic' },
            { checkOutSource: 'automatic' }
        ]
    }).select('userId adminId checkIn checkOut checkOutSource shifts');
    const sessions = new Map();

    for (const record of records) {
        const automaticShifts = record.shifts.filter(shift => shift.checkOutSource === 'automatic');
        if (automaticShifts.length) {
            for (const shift of automaticShifts) {
                const sessionStart = shift.sessionStart || shift.checkIn;
                if (!sessionStart) continue;
                const key = `${record.userId}:${record.adminId}:${+sessionStart}`;
                sessions.set(key, { userId: record.userId, adminId: record.adminId, sessionStart });
            }
        } else if (record.checkOutSource === 'automatic' && record.checkIn) {
            const key = `${record.userId}:${record.adminId}:${+record.checkIn}`;
            sessions.set(key, { userId: record.userId, adminId: record.adminId, sessionStart: record.checkIn });
        }
    }

    let migrated = 0;
    for (const attendanceSession of sessions.values()) {
        if (await migrateSession(attendanceSession)) migrated++;
    }

    console.log(`${applyChanges ? 'Migrated' : 'Previewed'} ${migrated} missed-checkout sessions.`);
};

run()
    .catch(error => {
        console.error('Missed-checkout migration failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
