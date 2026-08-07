const mongoose = require('mongoose');
require('dotenv').config();
const Attendance = require('./models/Attendance');

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        const records = await Attendance.find({ status: 'Absent' });
        let count = 0;
        for (const r of records) {
            let hasCompleted = false;
            if (r.shifts && r.shifts.length > 0) {
                hasCompleted = r.shifts.some(s => s.checkOut != null);
            } else if (r.checkOut != null && r.duration > 0) {
                hasCompleted = true; // Fallback for old records without shifts
            }

            if (hasCompleted) {
                await Attendance.updateOne({ _id: r._id }, { $set: { status: 'Present' } });
                count++;
                console.log(`Force-updated user ${r.userId} on ${r.date} to Present`);
            }
        }
        console.log(`Total force-updated: ${count}`);
        mongoose.disconnect();
    })
    .catch(err => console.error(err));
