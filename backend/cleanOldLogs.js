require('dotenv').config();
const mongoose = require('mongoose');
const Attendance = require('./models/Attendance');

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        console.log('Connected to DB');
        
        // Find all records where checkIn is not null, and status is Absent
        const records = await Attendance.find({
            checkIn: { $ne: null },
            status: 'Absent'
        });
        
        let fixedCount = 0;
        for (const record of records) {
            if (record.checkOut) {
                const checkInTime = new Date(record.checkIn).getTime();
                const checkOutTime = new Date(record.checkOut).getTime();
                
                // If they are exactly the same (auto-closed) or within 5 minutes (double scan bug)
                if (Math.abs(checkOutTime - checkInTime) < 5 * 60 * 1000) {
                    record.checkOut = null;
                    record.duration = 0;
                    
                    if (record.shifts && record.shifts.length > 0) {
                        const lastEntry = record.shifts[record.shifts.length - 1];
                        lastEntry.checkOut = null;
                        lastEntry.duration = 0;
                        lastEntry.missed = true; // explicitly mark as missed
                    }
                    
                    await record.save();
                    fixedCount++;
                    console.log(`Cleaned checkout for user ${record.userId} on ${record.date}`);
                }
            }
        }
        
        console.log(`Successfully cleaned ${fixedCount} old logs.`);
        mongoose.disconnect();
    })
    .catch(err => console.error(err));
