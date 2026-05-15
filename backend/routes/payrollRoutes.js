const express = require('express');
const router = express.Router();
const { generatePayroll, getPayrolls, updatePayrollStatus, deletePayroll, deleteAllPayrolls } = require('../controllers/payrollController');
const { protect, admin, requirePermission } = require('../middleware/authMiddleware');

router.post('/generate', protect, admin, requirePermission('payroll', 'edit'), generatePayroll);
router.get('/', protect, admin, requirePermission('payroll', 'view'), getPayrolls);
router.put('/:id/status', protect, admin, requirePermission('payroll', 'edit'), updatePayrollStatus);
router.delete('/delete-all', protect, admin, requirePermission('payroll', 'edit'), deleteAllPayrolls);
router.delete('/:id', protect, admin, requirePermission('payroll', 'edit'), deletePayroll);

module.exports = router;

