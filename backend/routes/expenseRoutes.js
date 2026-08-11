const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
    getExpenses,
    getEmployeeSummary,
    payFullSalary,
    payAdvanceSalary,
    addDeduction,
    addBonus,
    addCustomPayment,
    payPendingBonus,
    deleteExpense,
} = require('../controllers/expenseController');

// All routes require authentication + admin role
router.use(protect, admin);

// GET  /api/expenses?month=YYYY-MM          — all expenses for this tenant this month
router.get('/', getExpenses);

// GET  /api/expenses/summary/:userId?month= — salary summary + expenses for one employee
router.get('/summary/:userId', getEmployeeSummary);

// POST /api/expenses/full-salary            — mark full salary as paid
router.post('/full-salary', payFullSalary);

// POST /api/expenses/advance                — pay advance salary for a period
router.post('/advance', payAdvanceSalary);

// POST /api/expenses/deduction              — add a manual deduction
router.post('/deduction', addDeduction);

// POST /api/expenses/bonus                  — add bonus (paid now or pending)
router.post('/bonus', addBonus);

// POST /api/expenses/custom                 — record a custom payment
router.post('/custom', addCustomPayment);

// PATCH /api/expenses/:id/pay-bonus         — pay a pending bonus
router.patch('/:id/pay-bonus', payPendingBonus);

// DELETE /api/expenses/:id                  — delete an expense entry
router.delete('/:id', deleteExpense);

module.exports = router;
