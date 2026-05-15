const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        month: {
            type: String, // YYYY-MM
            required: true,
        },
        calculationStartDate: {
            type: String, // YYYY-MM-DD
        },
        calculationEndDate: {
            type: String, // YYYY-MM-DD
        },
        salary: {
            type: Number,
            required: true,
            default: 0,
        },
        totalDays: {
            type: Number,
            default: 30, // Keeping for backward compatibility
        },
        daysInMonth: {
            type: Number,
            default: 30,
        },
        payableDays: {
            type: Number, // The calculationEndDay (e.g. 25 if generated on 25th)
            default: 0,
        },
        offDays: {
            type: Number, // Number of off-days passed
            default: 0,
        },
        workingDays: {
            type: Number,
            default: 0,
        },
        presentDays: {
            type: Number,
            default: 0,
        },
        totalLates: {
            type: Number,
            default: 0,
        },
        totalAbsents: {
            type: Number, // The penalized count (e.g. 3 for Mon/Sat)
            default: 0,
        },
        actualAbsents: {
            type: Number, // The raw count of absent days
            default: 0,
        },
        totalLeaves: {
            type: Number, // 'On Leave' status (Approved + Auto-Leave)
            default: 0,
        },
        overtime: {
            minutes: { type: Number, default: 0 },
            pay: { type: Number, default: 0 },
        },
        shortHours: {
            minutes: { type: Number, default: 0 },
            pay: { type: Number, default: 0 },
        },
        deductions: {
            lateDeduction: { type: Number, default: 0 },
            absentDeduction: { type: Number, default: 0 },
            totalDeduction: { type: Number, default: 0 },
        },
        dailyBreakdown: [
            {
                date: String,
                status: String,
                workMinutes: Number,
                earnedSalary: Number
            }
        ],


        netSalary: {
            type: Number,
            required: true,
            default: 0,
        },
        status: {
            type: String,
            enum: ['Pending', 'Paid'],
            default: 'Pending',
        },
        paidAt: {
            type: Date,
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

// We allow multiple payrolls for history tracking, so NO unique index on month + userId.
const Payroll = mongoose.model('Payroll', payrollSchema);

module.exports = Payroll;
