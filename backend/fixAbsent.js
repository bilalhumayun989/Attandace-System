require('dotenv').config();
const mongoose = require('mongoose');
const Attendance = require('./models/Attendance');

// Connect to MongoDB using the URI from environment variables
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        console.log('Connected to DB');
        // Find all records marked as Absent but having at least one completed shift
        const records = await Attendance.find({ status: 'Absent' });
        
        let fixedCount = 0;
        for (const record of records) {
            if (record.shifts && record.shifts.length > 0) {
                const hasCompleted = record.shifts.some(s => s.checkOut != null);
                if (hasCompleted) {
                    record.status = 'Present';
                    
                    // Mark missed shift if needed
                    const lastEntry = record.shifts[record.shifts.length - 1];
                    if (!lastEntry.checkOut) {
                        lastEntry.missed = true;
                    }
                    
                    await record.save();
                    fixedCount++;
                    console.log(`Fixed record for user ${record.userId} on ${record.date}`);
                }
            }
        }
        
        console.log(`Successfully fixed ${fixedCount} records.`);
        mongoose.disconnect();
    })
    .catch(err => console.error(err));
