/**
 * One-time migration: Fix all employees with offDays:[0] (Sunday default)
 * to offDays:[5] (Friday default), since the system changed to Friday off.
 *
 * Run with: node scripts/migrate_offdays.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const run = async () => {
    try {
        console.log('Connecting to DB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        // Find all non-admin employees whose offDays is exactly [0] (Sunday only)
        const result = await User.updateMany(
            {
                role: { $ne: 'Admin' },
                offDays: [0]  // exactly Sunday-only set
            },
            {
                $set: { offDays: [5] }  // change to Friday
            }
        );

        console.log(`✅ Migration complete. Updated ${result.modifiedCount} employee(s) from offDays:[0] → offDays:[5].`);
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
    } finally {
        await mongoose.connection.close();
        console.log('DB connection closed.');
        process.exit(0);
    }
};

run();
