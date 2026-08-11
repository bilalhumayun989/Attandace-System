const mongoose = require('mongoose');

/**
 * Expense Model
 * Tracks all manual financial transactions against an employee:
 *  - full_salary   : mark the full calculated salary as paid
 *  - advance       : advance payment for a period (1-15, 16-end, full-month)
 *  - deduction     : one-off deduction applied to next payroll
 *  - bonus         : bonus — can be paid immediately or kept pending
 *  - custom        : any arbitrary amount paid outside normal payroll
 */
const expenseSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        // Type of transaction
        type: {
            type: String,
            enum: ['full_salary', 'advance', 'deduction', 'bonus', 'custom'],
            required: true,
        },

        // Amount involved
        amount: {
            type: Number,
            required: true,
            min: 0,
        },

        // Month this transaction belongs to (YYYY-MM)
        month: {
            type: String,
            required: true,
        },

        // For advance: which period was advanced
        advancePeriod: {
            type: String,
            enum: ['1-15', '16-end', 'full-month', null],
            default: null,
        },

        // Payment status
        status: {
            type: String,
            enum: ['Paid', 'Pending'],
            default: 'Paid',
        },

        // For bonus — can be pending to be paid later
        paidAt: {
            type: Date,
            default: null,
        },

        // Optional note from admin
        note: {
            type: String,
            default: '',
        },

        // Whether this amount should be deducted from next payroll calculation
        // true for: advance (deduct from salary), deduction
        // false for: bonus (adds to salary), custom (recorded separately)
        deductFromPayroll: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

// Index for fast lookup by employee + month
expenseSchema.index({ userId: 1, month: 1 });
expenseSchema.index({ adminId: 1, month: 1 });

const Expense = mongoose.model('Expense', expenseSchema);

module.exports = Expense;
