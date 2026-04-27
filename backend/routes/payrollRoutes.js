const express = require('express');
const router = express.Router();
const { generatePayroll, getPayrolls, updatePayrollStatus } = require('../controllers/payrollController');
const { protect, admin, requirePermission } = require('../middleware/authMiddleware');

router.post('/generate', protect, admin, requirePermission('payroll', 'edit'), generatePayroll);
router.get('/', protect, admin, requirePermission('payroll', 'view'), getPayrolls);
router.put('/:id/status', protect, admin, requirePermission('payroll', 'edit'), updatePayrollStatus);

module.exports = router;

