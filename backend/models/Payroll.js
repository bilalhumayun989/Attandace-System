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
        salary: {
            type: Number,
            required: true,
            default: 0,
        },
        totalDays: {
            type: Number,
            default: 30,
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
            type: Number, // Only 'Absent' status
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

// Prevent duplicate payrolls for the same user in the same month
payrollSchema.index({ userId: 1, month: 1 }, { unique: true });

const Payroll = mongoose.model('Payroll', payrollSchema);

module.exports = Payroll;
