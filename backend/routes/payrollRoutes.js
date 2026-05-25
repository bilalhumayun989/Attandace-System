const express = require('express');
const router = express.Router();
const { generatePayroll, getPayrolls, updatePayrollStatus, deletePayroll, deleteAllPayrolls } = require('../controllers/payrollController');
const { protect, admin, requirePermission } = require('../middleware/authMiddleware');

router.post('/generate', protect, admin, requirePermission('payroll', 'edit'), generatePayroll);
router.get('/', protect, admin, requirePermission('payroll', 'view'), getPayrolls);
router.put('/:id/status', protect, admin, requirePermission('payroll', 'edit'), updatePayrollStatus);
router.delete('/delete-all', protect, admin, requirePermission('payroll', 'edit'), deleteAllPayrolls);
router.delete('/:id', protect, admin, requirePermission('payroll', 'edit'), deletePayroll);

const { autoGenerateAndSendPayroll } = require('../utils/reportCron');

router.post('/test-cron', protect, admin, async (req, res) => {
    try {
        const { date } = req.body;
        if (date === 2) {
            await autoGenerateAndSendPayroll(31, 1);
        } else if (date === 17) {
            await autoGenerateAndSendPayroll(15, 0);
        } else {
            return res.status(400).json({ message: 'Invalid date parameter' });
        }
        res.json({ message: `Triggered cron for date ${date}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

