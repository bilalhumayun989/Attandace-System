const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Attendance = require('./models/Attendance');

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        const users = await User.find({ name: { $regex: 'Ershad', $options: 'i' } });
        for (const u of users) {
            console.log(`User ID: ${u._id} Name: ${u.name}`);
            const att = await Attendance.findOne({ userId: u._id, date: '2026-08-06' });
            if (att) {
                console.log(`Attendance 08-06:`, JSON.stringify(att, null, 2));
            } else {
                console.log(`No attendance for 08-06`);
            }
        }
        mongoose.disconnect();
    })
    .catch(err => console.error(err));
