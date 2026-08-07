const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Attendance = require('./models/Attendance');

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        const records = await Attendance.find({ date: '2026-08-06', status: 'Absent' }).populate('userId');
        console.log(`Found ${records.length} Absent records for 2026-08-06`);
        for (const r of records) {
            console.log(`User: ${r.userId?.name} | In: ${r.checkIn} | Out: ${r.checkOut} | Shifts: ${JSON.stringify(r.shifts)}`);
        }
        mongoose.disconnect();
    })
    .catch(err => console.error(err));
