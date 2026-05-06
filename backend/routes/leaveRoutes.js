const express = require('express');
const router = express.Router();
const { getFilteredEmployees, bulkUpdateEmployees } = require('../controllers/leaveController');
const { protect, admin } = require('../middleware/authMiddleware');

// Get employees with optional attendance filters
router.post('/filter', protect, admin, getFilteredEmployees);

// Bulk update employee leave and salary rules
router.put('/bulk-update', protect, admin, bulkUpdateEmployees);

module.exports = router;
