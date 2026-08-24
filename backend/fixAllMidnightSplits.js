require('dotenv').config();
const mongoose = require('mongoose');
const { formatInTimeZone } = require('date-fns-tz');
const Attendance = require('./models/Attendance');

// ─────────────────────────────────────────────────────────────────
//  COMPREHENSIVE MIDNIGHT-SPLIT REPAIR SCRIPT
//
//  Background:
//    The face-kiosk code used .setHours() with UTC-based Date objects,
//    so "midnight PKT" was calculated as 00:00 UTC = 05:00 AM PKT.
//    This script detects and corrects ALL mis-calculated records:
//
//    DAY1 records (cross-midnight night shift, first half):
//      Bug: checkOut stored as 23:59:59 UTC = 04:59:59 AM PKT next day.
//      Fix: checkOut should be 23:59:59 PKT (18:59:59 UTC same day).
//
//    DAY2 records (cross-midnight night shift, second half):
//      Bug: checkIn stored as 00:00:00 UTC = 05:00:00 AM PKT.
//      Fix: checkIn should be 00:00:00 PKT (19:00:00 UTC prev day).
//      Also: shifts array may have duplicate/conflicting entries from
//            the previous fixMidnightSplits.js run — these are merged.
//
//  Safety: Only targets records where the UTC time is EXACTLY at the
//  buggy boundary (00:00:00 UTC or 23:59:59 UTC), which cannot occur
//  naturally for real attendance events.
// ─────────────────────────────────────────────────────────────────

const getPKTDateString = (d) => formatInTimeZone(new Date(d), 'Asia/Karachi', 'yyyy-MM-dd');

// 00:00:00 UTC = 05:00:00 AM PKT  <- buggy nextDayStart
const isUTCMidnight = (date) => {
    const d = new Date(date);
    return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
};

// 23:59:59 UTC = 04:59:59 AM PKT next day <- buggy midnight (Day1 checkOut)
const isUTCEndOfDay = (date) => {
    const d = new Date(date);
    return d.getUTCHours() === 23 && d.getUTCMinutes() === 59 && d.getUTCSeconds() === 59;
};

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB.');
        console.log('Scanning ALL attendance records...\n');

        const allRecords = await Attendance.find({ checkIn: { $ne: null } }).lean();
        console.log(`Total records with checkIn: ${allRecords.length}\n`);

        let fixedDay1 = 0;
        let fixedDay2 = 0;
        let skipped   = 0;

        // =========================================================
        //  PASS 1: Fix DAY2 records
        //    Root checkIn is exactly at midnight UTC (= 5:00 AM PKT).
        //    Merge any duplicate shifts, correct checkIn to midnight PKT.
        // =========================================================
        const day2Records = allRecords.filter(r => isUTCMidnight(r.checkIn));
        console.log(`--- PASS 1: DAY2 records with checkIn = 5:00 AM PKT (00:00 UTC): ${day2Records.length} ---`);

        for (const record of day2Records) {
            // Correct checkIn: midnight PKT of this record's date
            const correctCheckIn = new Date(`${record.date}T00:00:00.000+05:00`);
            const checkOutTime   = record.checkOut ? new Date(record.checkOut) : null;

            if (!checkOutTime) {
                console.log(`  SKIP ${record._id} (${record.date}) -- no checkOut yet.`);
                skipped++;
                continue;
            }

            const correctDuration = Math.max(0, Math.floor((checkOutTime - correctCheckIn) / 60000));

            // Build single clean shift covering the whole day2 period
            const cleanShift = {
                checkIn:  correctCheckIn,
                checkOut: checkOutTime,
                duration: correctDuration,
                missed:   false
            };

            await Attendance.updateOne(
                { _id: record._id },
                {
                    $set: {
                        checkIn:  correctCheckIn,
                        duration: correctDuration,
                        status:   'Present',
                        shifts:   [cleanShift]
                    }
                }
            );

            console.log(`  FIXED Day2 ${record._id} (${record.date}) -- checkIn: 05:00 AM -> 12:00 AM PKT | duration: ${record.duration || 0}m -> ${correctDuration}m`);
            fixedDay2++;
        }

        // =========================================================
        //  PASS 2: Fix DAY1 records
        //    Root checkOut is exactly at 23:59:59 UTC (= 4:59:59 AM PKT)
        //    from the buggy .setHours(23,59,59,999).
        // =========================================================
        console.log(`\n--- PASS 2: DAY1 records with checkOut = 4:59 AM PKT (23:59:59 UTC) ---`);

        const freshRecords = await Attendance.find({ checkOut: { $ne: null } }).lean();
        const day1Records  = freshRecords.filter(r => isUTCEndOfDay(r.checkOut));
        console.log(`Found: ${day1Records.length}`);

        for (const record of day1Records) {
            // Correct checkOut: 23:59:59 PKT of this record's date
            const correctCheckOut = new Date(`${record.date}T23:59:59.999+05:00`);
            const checkInTime     = new Date(record.checkIn);

            const correctDuration = Math.max(0, Math.floor((correctCheckOut - checkInTime) / 60000));

            // Also fix shift entries that have wrong checkOut
            const fixedShifts = (record.shifts || []).map(s => {
                if (!s.checkOut) return s;
                if (isUTCEndOfDay(s.checkOut)) {
                    const correctedOut  = new Date(`${record.date}T23:59:59.999+05:00`);
                    const shiftDuration = Math.max(0, Math.floor((correctedOut - new Date(s.checkIn)) / 60000));
                    return { ...s, checkOut: correctedOut, duration: shiftDuration };
                }
                return s;
            });

            await Attendance.updateOne(
                { _id: record._id },
                {
                    $set: {
                        checkOut: correctCheckOut,
                        duration: correctDuration,
                        shifts:   fixedShifts
                    }
                }
            );

            console.log(`  FIXED Day1 ${record._id} (${record.date}) -- checkOut: 04:59 AM (next day) -> 11:59 PM PKT | duration: ${record.duration || 0}m -> ${correctDuration}m`);
            fixedDay1++;
        }

        // =========================================================
        //  PASS 3: Sanity-check shifts[] for remaining cross-midnight
        //  entries (edge cases not caught by passes 1 & 2).
        // =========================================================
        console.log(`\n--- PASS 3: Checking shifts arrays for remaining cross-midnight entries ---`);

        const allWithShifts = await Attendance.find({ 'shifts.0': { $exists: true } }).lean();
        let pass3Fixed = 0;

        for (const record of allWithShifts) {
            let changed = false;
            const cleanedShifts = (record.shifts || []).filter(s => {
                if (!s.checkIn || !s.checkOut) return true;
                const inDay  = getPKTDateString(s.checkIn);
                const outDay = getPKTDateString(s.checkOut);
                if (inDay !== outDay) {
                    console.log(`  Removing stale cross-midnight shift from record ${record._id} (${record.date})`);
                    changed = true;
                    return false;
                }
                return true;
            });

            if (changed) {
                const newDuration = cleanedShifts.reduce((sum, s) => {
                    if (!s.checkIn || !s.checkOut) return sum;
                    return sum + Math.max(0, Math.floor((new Date(s.checkOut) - new Date(s.checkIn)) / 60000));
                }, 0);

                const newCheckIn  = cleanedShifts.length > 0 ? cleanedShifts[0].checkIn : record.checkIn;
                const lastShift   = cleanedShifts[cleanedShifts.length - 1];
                const newCheckOut = lastShift ? (lastShift.checkOut || null) : record.checkOut;

                await Attendance.updateOne(
                    { _id: record._id },
                    { $set: { shifts: cleanedShifts, checkIn: newCheckIn, checkOut: newCheckOut, duration: newDuration } }
                );
                pass3Fixed++;
            }
        }
        console.log(`Pass 3 cleaned: ${pass3Fixed} records.`);

        // =========================================================
        //  SUMMARY
        // =========================================================
        console.log('\n=====================================================');
        console.log('  REPAIR COMPLETE');
        console.log('=====================================================');
        console.log(`  Day2 records fixed (checkIn 5AM -> 12AM PKT): ${fixedDay2}`);
        console.log(`  Day1 records fixed (checkOut 4:59AM -> 11:59PM PKT): ${fixedDay1}`);
        console.log(`  Pass 3 stale cross-midnight shifts removed: ${pass3Fixed}`);
        console.log(`  Skipped (no checkOut / already correct): ${skipped}`);
        console.log('=====================================================\n');

        mongoose.disconnect();
    })
    .catch(err => console.error('Connection error:', err));
