const Expense = require('../models/Expense');
const User = require('../models/User');
const Payroll = require('../models/Payroll');
const { generatePayrollService } = require('./payrollController');

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Returns the current month as YYYY-MM (PKT-safe)
 */
const getCurrentMonth = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
};

/**
 * Compute salary summary for an employee in a given month.
 * Aggregates all expenses for that month to show:
 *  - baseSalary        : employee's configured salary
 *  - totalAdvance      : total advance paid
 *  - totalDeductions   : sum of deduction entries
 *  - totalBonusPaid    : bonuses with status Paid
 *  - totalBonusPending : bonuses still pending
 *  - totalCustom       : custom payments made
 *  - netPayable        : baseSalary - totalAdvance - totalDeductions + totalBonusPaid - totalCustom
 *  - remainingBalance  : netPayable remaining after all paid amounts
 */
const computeSummary = async (userId, month) => {
    const user = await User.findById(userId).select('salary name employeeId department');
    if (!user) return null;

    const expenses = await Expense.find({ userId, month });

    const baseSalary = user.salary || 0;

    let totalAdvance      = 0;
    let totalDeductions   = 0;
    let totalBonusPaid    = 0;
    let totalBonusPending = 0;
    let totalCustom       = 0;
    let fullSalaryPaid    = false;
    let advancedPeriods   = [];

    for (const e of expenses) {
        switch (e.type) {
            case 'full_salary':
                fullSalaryPaid = true;
                break;
            case 'advance':
                totalAdvance += e.amount;
                if (e.advancePeriod) advancedPeriods.push(e.advancePeriod);
                break;
            case 'deduction':
                totalDeductions += e.amount;
                break;
            case 'bonus':
                if (e.status === 'Paid') totalBonusPaid += e.amount;
                else totalBonusPending += e.amount;
                break;
            case 'custom':
                totalCustom += e.amount;
                break;
        }
    }

    const netPayable = Math.max(0,
        baseSalary - totalAdvance - totalDeductions + totalBonusPaid
    );
    const totalPaid = totalAdvance + totalCustom + (fullSalaryPaid ? baseSalary : 0);
    const remainingBalance = Math.max(0, netPayable - totalPaid);

    return {
        user,
        baseSalary,
        totalAdvance,
        totalDeductions,
        totalBonusPaid,
        totalBonusPending,
        totalCustom,
        fullSalaryPaid,
        advancedPeriods,
        netPayable,
        totalPaid,
        remainingBalance,
        expenses,
    };
};

// ─── CONTROLLERS ────────────────────────────────────────────────────────────

/**
 * GET /api/expenses/summary/:userId?month=YYYY-MM
 * Returns salary summary + all expense entries for the employee this month
 */
const getEmployeeSummary = async (req, res) => {
    try {
        const { userId } = req.params;
        const month = req.query.month || getCurrentMonth();

        const summary = await computeSummary(userId, month);
        if (!summary) return res.status(404).json({ message: 'Employee not found.' });

        // Verify admin tenancy
        const user = await User.findById(userId);
        if (user.adminId?.toString() !== req.adminId?.toString()) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        // Calculate live earned salary using the same payroll engine
        // This reflects actual working days so far — same number shown in Payroll tab
        let currentEarnedSalary = 0;
        let presentDays = 0;
        let workingDays = 0;
        try {
            const payrolls = await generatePayrollService(req.adminId, month, null);
            const empPayroll = payrolls.find(p => p.userId?.toString() === userId || p.userId?._id?.toString() === userId);
            if (empPayroll) {
                currentEarnedSalary = empPayroll.netSalary || 0;
                presentDays        = empPayroll.presentDays || 0;
                workingDays        = empPayroll.workingDays || 0;
            }
        } catch (calcErr) {
            console.warn('[Expense] Could not compute live salary:', calcErr.message);
        }

        res.json({ ...summary, currentEarnedSalary, presentDays, workingDays });
    } catch (err) {
        console.error('[Expense] getEmployeeSummary error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

/**
 * GET /api/expenses?month=YYYY-MM
 * Returns all expenses for this admin's tenant for the given month
 */
const getExpenses = async (req, res) => {
    try {
        const month = req.query.month || getCurrentMonth();
        const expenses = await Expense.find({ adminId: req.adminId, month })
            .populate('userId', 'name employeeId department salary')
            .sort({ createdAt: -1 });
        res.json(expenses);
    } catch (err) {
        console.error('[Expense] getExpenses error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

/**
 * POST /api/expenses/full-salary
 * Mark an employee's full salary as paid for the month.
 * Body: { userId, month?, note? }
 */
const payFullSalary = async (req, res) => {
    try {
        const { userId, month, note } = req.body;
        const targetMonth = month || getCurrentMonth();

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'Employee not found.' });
        if (user.adminId?.toString() !== req.adminId?.toString()) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        // Prevent duplicate full-salary payment for same month
        const existing = await Expense.findOne({ userId, month: targetMonth, type: 'full_salary' });
        if (existing) {
            return res.status(400).json({ message: 'Full salary already marked as paid for this month.' });
        }

        const expense = await Expense.create({
            userId,
            adminId: req.adminId,
            type: 'full_salary',
            amount: user.salary || 0,
            month: targetMonth,
            status: 'Paid',
            paidAt: new Date(),
            note: note || '',
            deductFromPayroll: false,
        });

        // Also mark any Pending payroll for this month as Paid
        await Payroll.updateMany(
            { userId, month: targetMonth, status: 'Pending' },
            { status: 'Paid', paidAt: new Date() }
        );

        const summary = await computeSummary(userId, targetMonth);
        res.status(201).json({ message: 'Full salary marked as paid.', expense, summary });
    } catch (err) {
        console.error('[Expense] payFullSalary error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

/**
 * POST /api/expenses/advance
 * Pay advance salary for a period.
 * Body: { userId, advancePeriod ('1-15'|'16-end'|'full-month'), month?, note? }
 */
const payAdvanceSalary = async (req, res) => {
    try {
        const { userId, advancePeriod, month, note } = req.body;
        const targetMonth = month || getCurrentMonth();

        if (!['1-15', '16-end', 'full-month'].includes(advancePeriod)) {
            return res.status(400).json({ message: 'Invalid advancePeriod. Use: 1-15, 16-end, or full-month.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'Employee not found.' });
        if (user.adminId?.toString() !== req.adminId?.toString()) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        // Prevent duplicate advance for same period
        const existing = await Expense.findOne({ userId, month: targetMonth, type: 'advance', advancePeriod });
        if (existing) {
            return res.status(400).json({ message: `Advance for period "${advancePeriod}" already paid this month.` });
        }

        // Calculate advance amount based on period
        const baseSalary = user.salary || 0;
        let advanceAmount;
        if (advancePeriod === '1-15') {
            advanceAmount = Math.round(baseSalary / 2);
        } else if (advancePeriod === '16-end') {
            advanceAmount = Math.round(baseSalary / 2);
        } else {
            advanceAmount = baseSalary; // full month
        }

        const expense = await Expense.create({
            userId,
            adminId: req.adminId,
            type: 'advance',
            amount: advanceAmount,
            month: targetMonth,
            advancePeriod,
            status: 'Paid',
            paidAt: new Date(),
            note: note || '',
            deductFromPayroll: true, // will be deducted from final payroll
        });

        const summary = await computeSummary(userId, targetMonth);
        res.status(201).json({ message: `Advance salary for ${advancePeriod} paid. Will be deducted from payroll.`, expense, summary });
    } catch (err) {
        console.error('[Expense] payAdvanceSalary error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

/**
 * POST /api/expenses/deduction
 * Add a manual deduction.
 * Body: { userId, amount, month?, note? }
 */
const addDeduction = async (req, res) => {
    try {
        const { userId, amount, month, note } = req.body;
        const targetMonth = month || getCurrentMonth();

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Amount must be greater than 0.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'Employee not found.' });
        if (user.adminId?.toString() !== req.adminId?.toString()) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        const expense = await Expense.create({
            userId,
            adminId: req.adminId,
            type: 'deduction',
            amount: Number(amount),
            month: targetMonth,
            status: 'Paid',
            paidAt: new Date(),
            note: note || '',
            deductFromPayroll: true,
        });

        const summary = await computeSummary(userId, targetMonth);
        res.status(201).json({ message: 'Deduction recorded.', expense, summary });
    } catch (err) {
        console.error('[Expense] addDeduction error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

/**
 * POST /api/expenses/bonus
 * Add a bonus — paid immediately or pending.
 * Body: { userId, amount, payNow (bool), month?, note? }
 */
const addBonus = async (req, res) => {
    try {
        const { userId, amount, payNow, month, note } = req.body;
        const targetMonth = month || getCurrentMonth();

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Amount must be greater than 0.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'Employee not found.' });
        if (user.adminId?.toString() !== req.adminId?.toString()) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        const status = payNow ? 'Paid' : 'Pending';

        const expense = await Expense.create({
            userId,
            adminId: req.adminId,
            type: 'bonus',
            amount: Number(amount),
            month: targetMonth,
            status,
            paidAt: payNow ? new Date() : null,
            note: note || '',
            deductFromPayroll: false,
        });

        const summary = await computeSummary(userId, targetMonth);
        res.status(201).json({
            message: payNow ? 'Bonus paid immediately.' : 'Bonus added as pending — will be paid later.',
            expense,
            summary
        });
    } catch (err) {
        console.error('[Expense] addBonus error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

/**
 * POST /api/expenses/custom
 * Record a custom payment of any amount.
 * Body: { userId, amount, month?, note? }
 */
const addCustomPayment = async (req, res) => {
    try {
        const { userId, amount, month, note } = req.body;
        const targetMonth = month || getCurrentMonth();

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Amount must be greater than 0.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'Employee not found.' });
        if (user.adminId?.toString() !== req.adminId?.toString()) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        const expense = await Expense.create({
            userId,
            adminId: req.adminId,
            type: 'custom',
            amount: Number(amount),
            month: targetMonth,
            status: 'Paid',
            paidAt: new Date(),
            note: note || '',
            deductFromPayroll: false,
        });

        const summary = await computeSummary(userId, targetMonth);
        res.status(201).json({ message: 'Custom payment recorded.', expense, summary });
    } catch (err) {
        console.error('[Expense] addCustomPayment error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

/**
 * PATCH /api/expenses/:id/pay-bonus
 * Pay a pending bonus immediately.
 */
const payPendingBonus = async (req, res) => {
    try {
        const expense = await Expense.findById(req.params.id);
        if (!expense) return res.status(404).json({ message: 'Expense not found.' });
        if (expense.adminId?.toString() !== req.adminId?.toString()) {
            return res.status(403).json({ message: 'Access denied.' });
        }
        if (expense.type !== 'bonus') {
            return res.status(400).json({ message: 'This endpoint is only for bonus entries.' });
        }
        if (expense.status === 'Paid') {
            return res.status(400).json({ message: 'Bonus already paid.' });
        }

        expense.status = 'Paid';
        expense.paidAt = new Date();
        await expense.save();

        const summary = await computeSummary(expense.userId, expense.month);
        res.json({ message: 'Bonus paid.', expense, summary });
    } catch (err) {
        console.error('[Expense] payPendingBonus error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

/**
 * DELETE /api/expenses/:id
 * Delete an expense entry.
 */
const deleteExpense = async (req, res) => {
    try {
        const expense = await Expense.findById(req.params.id);
        if (!expense) return res.status(404).json({ message: 'Expense not found.' });
        if (expense.adminId?.toString() !== req.adminId?.toString()) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        await expense.deleteOne();
        const summary = await computeSummary(expense.userId, expense.month);
        res.json({ message: 'Expense deleted.', summary });
    } catch (err) {
        console.error('[Expense] deleteExpense error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

module.exports = {
    getExpenses,
    getEmployeeSummary,
    payFullSalary,
    payAdvanceSalary,
    addDeduction,
    addBonus,
    addCustomPayment,
    payPendingBonus,
    deleteExpense,
};
