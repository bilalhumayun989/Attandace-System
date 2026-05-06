const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { formatInTimeZone } = require('date-fns-tz');
const { sendDailyReport } = require('../utils/reportCron');

// @desc    Manually trigger daily report email (Admin)
// @route   POST /api/attendance/report/send
// @access  Private/Admin
const triggerManualReport = async (req, res) => {
    try {
        await sendDailyReport();
        res.json({ message: 'Daily report email triggered successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to send report', error: error.message });
    }
};


// Helper to get current PKT time
const getPKTTime = (date = new Date()) => {
    return new Date(formatInTimeZone(date, 'Asia/Karachi', "yyyy-MM-dd'T'HH:mm:ssXXX"));
};

const getPKTDateString = (date = new Date()) => {
    return formatInTimeZone(date, 'Asia/Karachi', 'yyyy-MM-dd');
};

// Helper to format 24h to 12h AM/PM
const format12h = (time24) => {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    const h = parseInt(hours);
    const m = minutes;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m} ${ampm}`;
};

// @desc    Reconcile missing attendance records (Automated Absent tracking)
const reconcileAttendance = async (userId) => {
    const user = await User.findById(userId);
    if (!user) return;

    const pktNow = getPKTTime();
    const todayStr = getPKTDateString(pktNow);

    // Start from joinDate to yesterday
    let current = new Date(user.joinDate || user.createdAt);
    if (isNaN(current.getTime())) {
        current = new Date(user.createdAt);
    }

    const yesterday = new Date(pktNow);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const yesterdayStr = getPKTDateString(yesterday);

    if (current > yesterday) return;

    try {
        // 1. Fetch all existing attendance records for this user in bulk
        const existingRecords = await Attendance.find({
            userId,
            date: { $lte: yesterdayStr }
        }).select('date status isAutoLeave');

        const recordMap = new Map(existingRecords.map(r => [r.date, r]));

        const newRecords = [];

        const userOffDays = user.offDays || [0];
        while (current <= yesterday) {
            const dateStr = getPKTDateString(current);
            const dayOfWeek = current.getDay();

            if (!recordMap.has(dateStr)) {
                if (!userOffDays.includes(dayOfWeek)) {
                    newRecords.push({
                        userId,
                        date: dateStr,
                        status: 'Absent',
                        adminId: user.adminId
                    });
                }
            }
            current.setDate(current.getDate() + 1);
        }

        if (newRecords.length > 0) {
            await Attendance.insertMany(newRecords);
        }
    } catch (error) {
        console.error('Error in reconcileAttendance:', error);
    }
};

// @desc    Check In
// @route   POST /api/attendance/checkin
// @access  Private
const checkIn = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const pktNow = getPKTTime();
        const dateStr = getPKTDateString(pktNow);

        // Check if already checked in today
        let attendance = await Attendance.findOne({ userId, date: dateStr });
        if (attendance && attendance.checkIn) {
            return res.status(400).json({ message: 'Already checked in today' });
        }

        // Fix: Create startTime specifically in Asia/Karachi timezone to avoid local-time dependency
        const startTimeStr = formatInTimeZone(pktNow, 'Asia/Karachi', `yyyy-MM-dd'T'${user.workingHours.start}:00XXX`);
        const startTime = new Date(startTimeStr);

        const diffInMs = pktNow - startTime;
        const diffInMins = diffInMs / (1000 * 60);

        const startTime12h = format12h(user.workingHours.start);

        // Attendance Rules:
        // 1. Can check in up to 5 mins early.
        if (diffInMins < -5) {
            return res.status(400).json({ message: `Check-in not enabled yet. Please wait until ${startTime12h}` });
        }

        // Late Threshold: 15 minutes grace period
        const status = diffInMins > 15 ? 'Late' : 'Present';

        if (!attendance) {
            attendance = new Attendance({
                userId,
                date: dateStr,
                checkIn: pktNow,
                status,
                adminId: req.adminId
            });
        } else {
            attendance.checkIn = pktNow;
            attendance.status = status;
        }

        await attendance.save();

        res.status(201).json({
            message: 'Check in successfully',
            attendance
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Check Out
// @route   POST /api/attendance/checkout
// @access  Private
const checkOut = async (req, res) => {
    try {
        const userId = req.user._id;
        const pktNow = getPKTTime();
        const dateStr = getPKTDateString(pktNow);

        const attendance = await Attendance.findOne({ userId, date: dateStr });

        if (!attendance || !attendance.checkIn) {
            return res.status(400).json({ message: 'You must check in first' });
        }

        if (attendance.checkOut) {
            return res.status(400).json({ message: 'Already checked out today' });
        }

        attendance.checkOut = pktNow;

        const checkInTime = new Date(attendance.checkIn);
        const durationMs = pktNow - checkInTime;
        const totalDurationMins = Math.floor(durationMs / (1000 * 60));
        
        attendance.duration = totalDurationMins > 0 ? totalDurationMins : 0;

        // Calculate required duration (Shift duration)
        const user = await User.findById(userId);
        if (user && user.workingHours) {
            const [startH, startM] = user.workingHours.start.split(':').map(Number);
            const [endH, endM] = user.workingHours.end.split(':').map(Number);

            let shiftDurationMins = (endH * 60 + endM) - (startH * 60 + startM);
            if (shiftDurationMins < 0) shiftDurationMins += 24 * 60; // Handle overnight shifts

            if (attendance.status === 'Late' && attendance.duration >= shiftDurationMins) {
                attendance.status = 'Present';
            }
            else if (attendance.duration < shiftDurationMins) {
                attendance.status = 'Short Hours';
            }
        }

        await attendance.save();

        let message = 'Checked out successfully';
        if (attendance.status === 'Short Hours') message = 'Checked out early (Short Hours)';

        res.json({
            message,
            attendance
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Get Current Status (for timer persistence)
// @route   GET /api/attendance/status
// @access  Private
const getAttendanceStatus = async (req, res) => {
    try {
        const userId = req.user._id;
        const pktNow = getPKTTime();
        const dateStr = getPKTDateString(pktNow);

        const attendance = await Attendance.findOne({ userId, date: dateStr });
        res.json(attendance || null);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Get Stats
// @route   GET /api/attendance/stats
// @access  Private
const getStats = async (req, res) => {
    try {
        const userId = req.user._id;

        // Trigger reconciliation before fetching stats
        await reconcileAttendance(userId);

        const allAttendance = await Attendance.find({ userId });

        const daysWorked = allAttendance.filter(a => a.checkIn).length;
        const lateCount = allAttendance.filter(a => a.status === 'Late').length;
        const totalAbsents = allAttendance.filter(a => a.status === 'Absent').length;

        // Today's status
        const pktNow = getPKTTime();
        const dateStr = getPKTDateString(pktNow);
        const todayRecord = allAttendance.find(a => a.date === dateStr);

        res.json({
            lateArrivals: lateCount,
            daysWorked,
            todayStatus: todayRecord ? todayRecord.status : 'Not Started',
            absents: totalAbsents
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Get all attendance (Admin)
// @route   GET /api/attendance
// @access  Private/Admin
const getAllAttendance = async (req, res) => {
    try {
        // Trigger reconciliation for all staff before fetching
        const users = await User.find({ role: { $ne: 'Admin' }, adminId: req.adminId });
        for (const user of users) {
            await reconcileAttendance(user._id);
        }

        const attendance = await Attendance.find({ adminId: req.adminId })
            .populate('userId', 'name employeeId role department workingHours')
            .sort({ date: -1, createdAt: -1 });
        res.json(attendance);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Update Attendance Status (Admin Manual Override)
// @route   PUT /api/attendance/:id
// @access  Private/Admin
const updateAttendance = async (req, res) => {
    try {
        const { status } = req.body;
        const attendance = await Attendance.findOne({ _id: req.params.id, adminId: req.adminId });

        if (!attendance) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }

        attendance.status = status || attendance.status;
        await attendance.save();

        res.json({ message: `Attendance updated to ${status}`, attendance });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Get a specific user's attendance history (Admin)
// @route   GET /api/attendance/user/:userId
// @access  Private/Admin
const getUserAttendanceHistory = async (req, res) => {
    try {
        const { userId } = req.params;

        // Trigger reconciliation for this user before fetching
        await reconcileAttendance(userId);

        const attendance = await Attendance.find({ userId })
            .populate('userId', 'name employeeId role department workingHours')
            .sort({ date: -1, createdAt: -1 });

        res.json(attendance);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Get logged-in user's attendance history
// @route   GET /api/attendance/my-history
// @access  Private
const getMyAttendanceHistory = async (req, res) => {

    try {
        const userId = req.user._id;
        const { month } = req.query; // YYYY-MM

        // Trigger reconciliation before fetching
        await reconcileAttendance(userId);

        const query = { userId };
        if (month) {
            query.date = { $regex: `^${month}` };
        }

        const attendance = await Attendance.find(query).sort({ date: -1 });
        res.json(attendance);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Overtime In
// @route   POST /api/attendance/overtime-in
// @access  Private
const overtimeIn = async (req, res) => {
    try {
        if (!req.user.isOvertimeAllowed) {
            return res.status(403).json({ message: 'You are not authorized to log overtime' });
        }
        
        const userId = req.user._id;
        const pktNow = getPKTTime();
        const dateStr = getPKTDateString(pktNow);
        let attendance = await Attendance.findOne({ userId, date: dateStr });
        
        if (!attendance) {
            attendance = new Attendance({
                userId,
                date: dateStr,
                status: 'Absent',
                adminId: req.adminId
            });
        }
        
        if (attendance.overtimeIn) return res.status(400).json({ message: 'Overtime already started' });
        attendance.overtimeIn = pktNow;
        attendance.overtimeStatus = 'Pending';
        await attendance.save();
        res.json({ message: 'Overtime started successfully', attendance });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Overtime Out
// @route   POST /api/attendance/overtime-out
// @access  Private
const overtimeOut = async (req, res) => {
    try {
        if (!req.user.isOvertimeAllowed) {
            return res.status(403).json({ message: 'You are not authorized to log overtime' });
        }

        const userId = req.user._id;
        const pktNow = getPKTTime();
        const dateStr = getPKTDateString(pktNow);
        const attendance = await Attendance.findOne({ userId, date: dateStr });
        if (!attendance || !attendance.overtimeIn) return res.status(400).json({ message: 'No overtime started' });
        if (attendance.overtimeOut) return res.status(400).json({ message: 'Overtime already ended' });
        attendance.overtimeOut = pktNow;
        attendance.overtimeStatus = 'Pending';
        await attendance.save();
        res.json({ message: 'Overtime ended successfully, waiting for admin approval', attendance });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Approve/Reject Overtime (Admin)
// @route   PUT /api/attendance/overtime/approve/:id
// @access  Private/Admin
const approveOvertime = async (req, res) => {
    try {
        const { status, reason } = req.body; 
        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const attendance = await Attendance.findOne({ _id: req.params.id, adminId: req.adminId });
        if (!attendance) return res.status(404).json({ message: 'Record not found' });

        attendance.overtimeStatus = status;
        if (status === 'Rejected') {
            attendance.overtimeRejectReason = reason || 'No reason provided';
        }
        await attendance.save();

        res.json({ message: `Overtime ${status.toLowerCase()} successfully`, attendance });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Enroll employee face
// @route   POST /api/attendance/enroll-face
// @access  Private/Admin
const enrollFace = async (req, res) => {
    try {
        const { userId, descriptors } = req.body;
        if (!userId || !descriptors) {
            return res.status(400).json({ success: false, message: 'Missing userId or descriptors' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.faceDescriptors = descriptors;
        user.faceEnrolled = true;
        await user.save();

        res.json({ success: true, message: 'Face enrolled successfully' });
    } catch (error) {
        console.error('Error in enrollFace:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Get all face descriptors
// @route   GET /api/attendance/face-descriptors
// @access  Public
const getFaceDescriptors = async (req, res) => {
    try {
        const employees = await User.find({ faceEnrolled: true }).select('_id name faceDescriptors isOvertimeAllowed workingHours');
        res.json({ employees });
    } catch (error) {
        console.error('Error in getFaceDescriptors:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Auto Check-In/Out via Face Recognition (with Shift & Overtime Logic)
// @route   POST /api/attendance/face-checkin
// @access  Public
const faceCheckIn = async (req, res) => {
    try {
        const { userId, timestamp } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const pktNow = getPKTTime(new Date(timestamp));
        const dateStr = getPKTDateString(pktNow);

        // Get Shift Boundaries
        let shiftStartTime = null;
        let shiftEndTime = null;
        if (user.workingHours) {
            shiftStartTime = new Date(formatInTimeZone(pktNow, 'Asia/Karachi', `yyyy-MM-dd'T'${user.workingHours.start}:00XXX`));
            shiftEndTime = new Date(formatInTimeZone(pktNow, 'Asia/Karachi', `yyyy-MM-dd'T'${user.workingHours.end}:00XXX`));
            
            // Handle overnight shift end
            if (shiftEndTime < shiftStartTime) {
                shiftEndTime.setDate(shiftEndTime.getDate() + 1);
            }
        }

        let attendance = await Attendance.findOne({ userId, date: dateStr });

        // --- CASE 1: INITIAL SCAN (Check-In or Overtime Start) ---
        if (!attendance) {
            // Check if shift has already passed
            if (shiftEndTime && pktNow > shiftEndTime) {
                if (user.isOvertimeAllowed) {
                    attendance = new Attendance({
                        userId,
                        date: dateStr,
                        overtimeIn: pktNow,
                        overtimeStatus: 'Pending',
                        status: 'Absent',
                        adminId: user.adminId,
                        markedByFace: true
                    });
                    await attendance.save();
                    return res.json({
                        action: 'checkin',
                        employeeName: user.name,
                        checkInTime: format12h(formatInTimeZone(pktNow, 'Asia/Karachi', 'HH:mm')),
                        message: 'Overtime started'
                    });
                } else {
                    return res.json({
                        action: 'completed',
                        employeeName: user.name,
                        message: 'Your shift time has already passed'
                    });
                }
            }

            attendance = new Attendance({
                userId,
                date: dateStr,
                checkIn: pktNow,
                status: (shiftStartTime && pktNow > new Date(shiftStartTime.getTime() + 15 * 60000)) ? 'Late' : 'Present',
                adminId: user.adminId,
                markedByFace: true
            });
            await attendance.save();

            return res.json({
                action: 'checkin',
                employeeName: user.name,
                checkInTime: format12h(formatInTimeZone(pktNow, 'Asia/Karachi', 'HH:mm')),
                message: 'Checked In'
            });
        }

        // --- CASE 2: REPEAT SCAN (Check-Out or Overtime Out) ---
        if (attendance.checkOut || attendance.overtimeOut) {
            return res.json({
                action: 'completed',
                employeeName: user.name,
                message: 'Shift already completed'
            });
        }

        if (attendance.checkIn && !attendance.checkOut) {
            attendance.checkOut = pktNow;
            attendance.markedByFace = true;

            const checkInTime = new Date(attendance.checkIn);
            let effectiveCheckOut = pktNow;

            if (!user.isOvertimeAllowed && shiftEndTime && pktNow > shiftEndTime) {
                effectiveCheckOut = shiftEndTime;
            }

            const regularDurationMs = Math.max(0, effectiveCheckOut - checkInTime);
            attendance.duration = Math.floor(regularDurationMs / (1000 * 60));

            if (user.isOvertimeAllowed && shiftEndTime && pktNow > shiftEndTime) {
                attendance.overtimeIn = shiftEndTime > checkInTime ? shiftEndTime : checkInTime;
                attendance.overtimeOut = pktNow;
                attendance.overtimeStatus = 'Pending';
            }

            await attendance.save();

            return res.json({
                action: 'checkout',
                employeeName: user.name,
                checkOutTime: format12h(formatInTimeZone(pktNow, 'Asia/Karachi', 'HH:mm')),
                message: user.isOvertimeAllowed && pktNow > shiftEndTime ? 'Check-out & Overtime Recorded' : 'Checked Out'
            });
        }

        if (attendance.overtimeIn && !attendance.overtimeOut) {
            attendance.overtimeOut = pktNow;
            attendance.markedByFace = true;
            attendance.overtimeStatus = 'Pending';
            await attendance.save();

            return res.json({
                action: 'checkout',
                employeeName: user.name,
                checkOutTime: format12h(formatInTimeZone(pktNow, 'Asia/Karachi', 'HH:mm')),
                message: 'Overtime Ended'
            });
        }

        return res.json({ action: 'none', message: 'No action taken' });

    } catch (error) {
        console.error('Error in faceCheckIn:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

module.exports = {
    reconcileAttendance,
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
};
