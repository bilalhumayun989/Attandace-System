const mongoose = require('mongoose');

const shiftSessionSchema = new mongoose.Schema({
    checkIn: { type: Date },
    checkOut: { type: Date },
    duration: { type: Number, default: 0 }, // in minutes
    missed: { type: Boolean, default: false }, // true = employee checked in but never checked out
}, { _id: false });

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
            type: Number, // in minutes — total for the day (sum of all shifts)
            default: 0,
        },
        // Array of individual shift sessions for this day
        shifts: {
            type: [shiftSessionSchema],
            default: [],
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
        overtimeIn: {
            type: Date,
        },
        overtimeOut: {
            type: Date,
        },
        overtimeStatus: {
            type: String,
            enum: ['None', 'Pending', 'Approved', 'Rejected'],
            default: 'None',
        },
        overtimeRejectReason: {
            type: String,
        },
        isAutoLeave: {
            type: Boolean,
            default: false,
        },
        markedByFace: {
            type: Boolean,
            default: false,
        },
        isCustom: {
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
