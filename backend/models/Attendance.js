const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        date: {
            type: String, // YYYY-MM-DD
            required: true,
        },
        checkIn: {
            type: Date,
        },
        checkOut: {
            type: Date,
        },
        duration: {
            type: Number, // in minutes
            default: 0,
        },
        status: {
            type: String,
            enum: ['Present', 'Late', 'Absent', 'Short Hours', 'On Leave'],
            default: 'Present',
        },
        isCheckingOut: {
            type: Boolean,
            default: false,
        },
        isAutoLeave: {
            type: Boolean,
            default: false,
        },
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        }
    },
    {
        timestamps: true,
    }
);

// Compound index to ensure one attendance record per user per day
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;
