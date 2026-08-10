require('dotenv').config();
const mongoose = require('mongoose');
const { formatInTimeZone } = require('date-fns-tz');
const User = require('./models/User');
const Attendance = require('./models/Attendance');

const getPKTDateString = (d) => formatInTimeZone(new Date(d), 'Asia/Karachi', 'yyyy-MM-dd');

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        const allRecords = await Attendance.find({ 'shifts.0': { $exists: true } }).lean();

        let fixedCount = 0;
        let skippedCount = 0;

        for (const record of allRecords) {
            let hasCrossShift = false;
            const newShifts = [...record.shifts];

            for (let i = 0; i < newShifts.length; i++) {
                const shift = newShifts[i];
                if (!shift.checkIn || !shift.checkOut) continue;

                const inDay = getPKTDateString(shift.checkIn);
                const outDay = getPKTDateString(shift.checkOut);

                if (inDay !== outDay && inDay === record.date) {
                    hasCrossShift = true;
                    const checkInTime = new Date(shift.checkIn);
                    const checkOutTime = new Date(shift.checkOut);

                    // midnight of inDay
                    const midnight = new Date(checkInTime);
                    midnight.setHours(23, 59, 59, 999);

                    const day1Mins = Math.max(0, Math.floor((midnight - checkInTime) / 60000));
                    
                    const nextDayStart = new Date(checkOutTime);
                    nextDayStart.setHours(0, 0, 0, 0);
                    const day2Mins = Math.max(0, Math.floor((checkOutTime - nextDayStart) / 60000));

                    console.log(`Fixing record ${record._id} (${record.date}): shift ${i} crosses midnight. Day1: ${day1Mins}m | Day2: ${day2Mins}m`);

                    // Fix this shift entry to only go to midnight
                    newShifts[i] = {
                        ...shift,
                        checkOut: midnight,
                        duration: day1Mins
                    };

                    // Recalculate day1 total duration from all shifts that belong to this date
                    const day1Duration = newShifts.reduce((sum, s) => {
                        if (!s.checkIn || !s.checkOut) return sum;
                        if (getPKTDateString(s.checkIn) === record.date) return sum + (s.duration || 0);
                        return sum;
                    }, 0);

                    // Update the day1 record directly
                    await Attendance.updateOne(
                        { _id: record._id },
                        { $set: { shifts: newShifts, checkOut: midnight, duration: day1Duration } }
                    );

                    // Fix day2 record
                    const nextDayStr = outDay;
                    const existingDay2 = await Attendance.findOne({ userId: record.userId, date: nextDayStr }).lean();

                    if (!existingDay2) {
                        await Attendance.create({
                            userId: record.userId,
                            date: nextDayStr,
                            checkIn: nextDayStart,
                            checkOut: checkOutTime,
                            duration: day2Mins,
                            status: 'Present',
                            adminId: record.adminId,
                            markedByFace: record.markedByFace || false,
                            shifts: [{ checkIn: nextDayStart, checkOut: checkOutTime, duration: day2Mins }]
                        });
                        console.log(`  Created day2 record for ${nextDayStr}: ${day2Mins}m`);
                    } else {
                        // Check if the next-day split entry already exists (avoid double-add)
                        const alreadySplit = existingDay2.shifts && existingDay2.shifts.some(s => {
                            if (!s.checkIn) return false;
                            return Math.abs(new Date(s.checkIn).getTime() - nextDayStart.getTime()) < 60000;
                        });

                        if (!alreadySplit) {
                            await Attendance.updateOne(
                                { _id: existingDay2._id },
                                {
                                    $push: { shifts: { checkIn: nextDayStart, checkOut: checkOutTime, duration: day2Mins } },
                                    $inc: { duration: day2Mins }
                                }
                            );
                            console.log(`  Updated day2 record for ${nextDayStr}: added ${day2Mins}m`);
                        } else {
                            console.log(`  Day2 record for ${nextDayStr} already has split entry, skipping.`);
                            skippedCount++;
                        }
                    }
                    fixedCount++;
                }
            }
        }

        console.log(`\nDone. Fixed: ${fixedCount} cross-midnight shift entries. Skipped (already correct): ${skippedCount}.`);
        mongoose.disconnect();
    })
    .catch(err => console.error(err));
