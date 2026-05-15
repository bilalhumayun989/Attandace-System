const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const testData = async () => {
    try {
        if (!process.env.MONGO_URI) {
            console.error("❌ MONGO_URI not found in .env file");
            process.exit(1);
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Connected to MongoDB...");

        // 1. Find the first employee to test with
        const user = await User.findOne({ role: { $ne: 'Admin' } });
        if (!user) {
            console.log("❌ No employee found in database to test with. Please add an employee first.");
            process.exit(1);
        }

        console.log(`🚀 Starting data injection for user: ${user.name} (${user.employeeId})`);
        
        // 2. Set testing month (May 2026)
        const monthPrefix = "2026-05"; 
        
        // Clear previous attendance for this month to prevent duplicates
        const deleteResult = await Attendance.deleteMany({ 
            userId: user._id, 
            date: { $regex: `^${monthPrefix}` } 
        });
        console.log(`🧹 Cleared ${deleteResult.deletedCount} existing records for ${monthPrefix}`);

        // 3. Define Test Scenarios
        // Shift is assumed 09:00 to 17:00 (8 hours)
        const scenarios = [
            { day: "01", in: "09:00", out: "17:00", status: "Present", note: "NORMAL: Full 8 hours worked." },
            { day: "02", in: "11:00", out: "17:00", status: "Late",    note: "LATE: Came 2 hours late. Salary should deduct 2 hours." },
            { day: "03", in: "11:00", out: null,    status: "Late",    note: "MISSED CHECKOUT: No exit time. Salary MUST be 0." },
            { day: "04", in: "09:00", out: "20:00", status: "Present", note: "OVERTIME: Worked 3 extra hours. Check if OT counts." },
            { day: "05", in: "09:00", out: "13:00", status: "Short Hours", note: "SHORT HOURS: Left 4 hours early. Salary should deduct 4 hours." },
            { day: "08", in: "09:00", out: "17:00", status: "Present", note: "NORMAL: Another full day." },
            // Note: Day 06 and 07 are skipped (will show as Absent if not Sunday)
        ];

        for (const s of scenarios) {
            const dateStr = `${monthPrefix}-${s.day}`;
            const checkInDate = s.in ? new Date(`${dateStr}T${s.in}:00+05:00`) : null;
            const checkOutDate = s.out ? new Date(`${dateStr}T${s.out}:00+05:00`) : null;
            
            let duration = 0;
            if (checkInDate && checkOutDate) {
                duration = Math.floor((checkOutDate - checkInDate) / (1000 * 60));
            }

            const record = new Attendance({
                userId: user._id,
                date: dateStr,
                checkIn: checkInDate,
                checkOut: checkOutDate,
                status: s.status,
                adminId: user.adminId,
                duration: duration,
                markedByFace: true
            });

            await record.save();
            console.log(`   📍 Injected: ${dateStr} | In: ${s.in || 'NONE'} | Out: ${s.out || 'NONE'} | ${s.note}`);
        }

        console.log("\n✨ ALL TEST DATA INJECTED SUCCESSFULLY!");
        console.log("👉 Now go to Payroll Management in your browser.");
        console.log("👉 Select 'May 2026' and Generate Payroll for this user.");
        console.log("👉 Open 'View Detailed Breakdown' to see the magic!");
        
        process.exit(0);
    } catch (err) {
        console.error("❌ Error during injection:", err);
        process.exit(1);
    }
};

testData();
