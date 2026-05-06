const express = require('express');
const router = express.Router();
const {
    checkIn,
    checkOut,
    overtimeIn,
    overtimeOut,
    getAttendanceStatus,
    getStats,
    getAllAttendance,
    updateAttendance,
    getUserAttendanceHistory,
    getMyAttendanceHistory,
    approveOvertime,
    triggerManualReport,
    enrollFace,
    getFaceDescriptors,
    faceCheckIn
} = require('../controllers/attendanceController');
const { protect, admin, requirePermission } = require('../middleware/authMiddleware');

// Public Face Recognition routes
router.get('/face-descriptors', getFaceDescriptors); // No auth
router.post('/face-checkin', faceCheckIn); // No auth

router.use(protect); // All attendance routes below are protected

// Employee routes
router.post('/checkin', checkIn);
router.post('/checkout', checkOut);
router.post('/overtime-in', overtimeIn);
router.post('/overtime-out', overtimeOut);
router.get('/status', getAttendanceStatus);
router.get('/stats', getStats);
router.get('/my-history', getMyAttendanceHistory);


// Admin routes
router.get('/', admin, requirePermission('attendance', 'view'), getAllAttendance);
router.get('/user/:userId', admin, requirePermission('attendance', 'view'), getUserAttendanceHistory);
router.post('/report/send', admin, requirePermission('attendance', 'view'), triggerManualReport);
router.put('/overtime/approve/:id', admin, requirePermission('attendance', 'edit'), approveOvertime);
router.put('/:id', admin, requirePermission('attendance', 'edit'), updateAttendance);

// Face Recognition routes
router.post('/enroll-face', admin, enrollFace);

module.exports = router;

