const express = require('express');
const router = express.Router();
const {
    checkIn,
    checkOut,
    getAttendanceStatus,
    getStats,
    getAllAttendance,
    updateAttendance,
    getUserAttendanceHistory,
    getMyAttendanceHistory
} = require('../controllers/attendanceController');
const { protect, admin, requirePermission } = require('../middleware/authMiddleware');

router.use(protect); // All attendance routes are protected

// Employee routes
router.post('/checkin', checkIn);
router.post('/checkout', checkOut);
router.get('/status', getAttendanceStatus);
router.get('/stats', getStats);
router.get('/my-history', getMyAttendanceHistory);


// Admin routes
router.get('/', admin, requirePermission('attendance', 'view'), getAllAttendance);
router.get('/user/:userId', admin, requirePermission('attendance', 'view'), getUserAttendanceHistory);
router.put('/:id', admin, requirePermission('attendance', 'edit'), updateAttendance);

module.exports = router;

