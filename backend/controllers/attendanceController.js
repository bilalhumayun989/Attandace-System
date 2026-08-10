const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { formatInTimeZone } = require('date-fns-tz');
const { sendDailyReport } = require('../utils/reportCron');

// @desc    Manually trigger daily report email (Admin)
// @route   POST /api/attendance/report/send
// @access  Private/Admin
const triggerManualReport = async (req, res) => {
    try {
        let tenantId;

        console.log(`[triggerManualReport] user._id=${req.user._id} role=${req.user.role} adminId=${req.user.adminId}`);

        if (req.user.role === 'Admin') {
            // Admin is their own tenant root — adminId == their own _id
            tenantId = req.user._id;
        } else if (req.user.role === 'SuperAdmin') {
            if (req.user.adminId && req.user.adminId.toString() !== req.user._id.toString()) {
                tenantId = req.user.adminId;
            } else {
                const freshUser = await User.findById(req.user._id).select('adminId role');
                console.log(`[triggerManualReport] freshUser adminId=${freshUser?.adminId}`);
                if (freshUser?.adminId) tenantId = freshUser.adminId;
            }
        }

        if (!tenantId) {
            return res.status(400).json({ message: 'Could not resolve tenant admin — check your account adminId.' });
        }

        console.log(`[triggerManualReport] resolved tenantId=${tenantId}`);

        // Find the tenant Admin — role may be 'Admin' or 'SuperAdmin' acting as root
        let tenantAdmin = await User.findOne({ _id: tenantId, role: 'Admin' });
        if (!tenantAdmin) {
            // Edge case: this user IS the admin (adminId == _id) but query missed — try direct lookup
            tenantAdmin = await User.findById(tenantId);
            console.log(`[triggerManualReport] fallback lookup: found=${!!tenantAdmin} role=${tenantAdmin?.role}`);
            if (!tenantAdmin || (tenantAdmin.role !== 'Admin' && tenantAdmin.role !== 'SuperAdmin')) {
                return res.status(400).json({ message: `No Admin found for tenant ID ${tenantId}.` });
            }
            tenantId = tenantAdmin._id;
        }

        const result = await sendDailyReport(tenantId);
        res.json({ message: 'Daily report email triggered successfully', result });
    } catch (error) {
        console.error('[triggerManualReport Error]', error);
        res.status(500).json({ message: 'Failed to send report', error: error.message });
    }
};


// Helper to get current PKT time
const getPKTTime = (date = new Date()) => {
    // If date is a string and doesn't contain timezone info, assume it's PKT
    if (typeof date === 'string' && !date.includes('Z') && !date.includes('+') && !date.includes('-')) {
        // Append PKT offset (+05:00)
        date = date + '+05:00';
    }
    return new Date(formatInTimeZone(new Date(date), 'Asia/Karachi', "yyyy-MM-dd'T'HH:mm:ssXXX"));
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

        const userOffDays = (user.offDays && user.offDays.length > 0) ? user.offDays : [5]; // Default Friday
        while (current <= yesterday) {
            const dateStr = getPKTDateString(current);
            const dayOfWeek = current.getDay();

            if (!recordMap.has(dateStr)) {
                if (!userOffDays.includes(dayOfWeek) && !(user.vacations && user.vacations.includes(dateStr))) {
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

// @desc    Reconcile missing attendance records for multiple users in bulk
const reconcileMultipleUsersAttendance = async (users) => {
    if (!users || users.length === 0) return;

    const pktNow = getPKTTime();
    const todayStr = getPKTDateString(pktNow);

    const yesterday = new Date(pktNow);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const yesterdayStr = getPKTDateString(yesterday);

    try {
        const userIds = users.map(u => u._id);
        const existingRecords = await Attendance.find({
            userId: { $in: userIds },
            date: { $lte: yesterdayStr }
        }).select('userId date status isAutoLeave');

        // Group by user ID
        const recordsByUser = {};
        for (const r of existingRecords) {
            const uid = r.userId.toString();
            if (!recordsByUser[uid]) recordsByUser[uid] = new Set();
            recordsByUser[uid].add(r.date);
        }

        const newRecords = [];

        for (const user of users) {
            let current = new Date(user.joinDate || user.createdAt);
            if (isNaN(current.getTime())) {
                current = new Date(user.createdAt);
            }

            if (current > yesterday) continue;

            const userOffDays = (user.offDays && user.offDays.length > 0) ? user.offDays : [5];
            const userSet = recordsByUser[user._id.toString()] || new Set();

            while (current <= yesterday) {
                const dateStr = getPKTDateString(current);
                const dayOfWeek = current.getDay();

                if (!userSet.has(dateStr)) {
                    if (!userOffDays.includes(dayOfWeek) && !(user.vacations && user.vacations.includes(dateStr))) {
                        newRecords.push({
                            userId: user._id,
                            date: dateStr,
                            status: 'Absent',
                            adminId: user.adminId
                        });
                    }
                }
                current.setDate(current.getDate() + 1);
            }
        }

        if (newRecords.length > 0) {
            await Attendance.insertMany(newRecords);
        }
    } catch (error) {
        console.error('Error in reconcileMultipleUsersAttendance:', error);
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
        if (user.status === 'Deleted') return res.status(400).json({ message: 'Deleted users cannot mark attendance' });

        const pktNow = getPKTTime();
        const dateStr = getPKTDateString(pktNow);

        // Find the most recent open shift
        const openShift = await Attendance.findOne({
            userId,
            checkIn: { $ne: null },
            checkOut: null
        }).sort({ checkIn: -1 });

        if (openShift) {
            // Check if it's older than 20 hours
            const twentyHoursAgo = new Date(pktNow.getTime() - (20 * 60 * 60 * 1000));
            if (openShift.checkIn < twentyHoursAgo) {
                // Auto-close — preserve Present if a prior completed shift exists
                const hasCompletedShifts = openShift.shifts && openShift.shifts.some(s => s.checkOut);
                openShift.status = hasCompletedShifts ? 'Present' : 'Absent';
                // Flag the open shift entry as missed
                if (openShift.shifts && openShift.shifts.length > 0) {
                    const lastEntry = openShift.shifts[openShift.shifts.length - 1];
                    if (lastEntry && !lastEntry.checkOut) {
                        lastEntry.missed = true;
                    }
                }
                openShift.checkOut = openShift.checkIn; // close it so it's no longer open
                await openShift.save();
            } else {
                return res.status(400).json({ message: 'You have an ongoing shift. Please check out first.' });
            }
        }

        // Check if there's already a record for today
        let attendance = await Attendance.findOne({ userId, date: dateStr });

        const status = 'Present';

        if (!attendance) {
            attendance = new Attendance({
                userId,
                date: dateStr,
                checkIn: pktNow,
                status,
                adminId: req.adminId
            });
        } else {
            // They already worked today and checked out. We allow them to start another shift.
            // We do NOT reset the duration. We just open the shift again.
            attendance.checkIn = pktNow;
            attendance.checkOut = null; // Re-open the shift
            attendance.status = status;
            // Push an open placeholder into shifts[] so the detail modal can show this shift immediately
            if (!attendance.shifts) attendance.shifts = [];
            attendance.shifts.push({ checkIn: pktNow, checkOut: null, duration: 0 });
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

const checkOut = async (req, res) => {
    try {
        const userId = req.user._id;
        const pktNow = getPKTTime();

        // Find the most recent open shift
        let attendance = await Attendance.findOne({
            userId,
            checkIn: { $ne: null },
            checkOut: null
        }).sort({ checkIn: -1 });

        if (!attendance) {
             return res.status(400).json({ message: 'No active shift found. You must check in first.' });
        }

        // Check if it's older than 20 hours
        const twentyHoursAgo = new Date(pktNow.getTime() - (20 * 60 * 60 * 1000));
        if (attendance.checkIn < twentyHoursAgo) {
            // Preserve Present if a prior completed shift exists on this record
            const hasCompletedShifts = attendance.shifts && attendance.shifts.some(s => s.checkOut);
            attendance.status = hasCompletedShifts ? 'Present' : 'Absent';
            // Flag the last open shift entry as missed
            if (attendance.shifts && attendance.shifts.length > 0) {
                const lastEntry = attendance.shifts[attendance.shifts.length - 1];
                if (lastEntry && !lastEntry.checkOut) {
                    lastEntry.missed = true;
                }
            }
            await attendance.save();
            return res.status(400).json({ message: 'Your previous shift expired after 20 hours. Please check in again.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (user.status === 'Deleted') return res.status(400).json({ message: 'Deleted users cannot mark attendance' });

        const checkInTime = new Date(attendance.checkIn);
        let effectiveCheckOut = pktNow;
        
        // Check if the shift crosses midnight
        const checkInDateStr = getPKTDateString(checkInTime);
        const checkOutDateStr = getPKTDateString(effectiveCheckOut);

        if (checkInDateStr !== checkOutDateStr) {
            // Crosses midnight! Split the hours.
            // 1. Calculate time until midnight for the check-in day
            const midnight = new Date(`${checkInDateStr}T23:59:59.999+05:00`);
            
            const durationMsDay1 = midnight - checkInTime;
            const durationMinsDay1 = Math.floor(durationMsDay1 / (1000 * 60));
            
            attendance.checkOut = midnight;
            attendance.duration = (attendance.duration || 0) + (durationMinsDay1 > 0 ? durationMinsDay1 : 0);
            attendance.status = 'Present';
            // Record this partial session (up to midnight)
            if (!attendance.shifts) attendance.shifts = [];
            attendance.shifts.push({
                checkIn: checkInTime,
                checkOut: midnight,
                duration: durationMinsDay1 > 0 ? durationMinsDay1 : 0
            });
            await attendance.save();

            // 2. Calculate time from midnight to checkout for the next day
            const nextDayStart = new Date(`${checkOutDateStr}T00:00:00.000+05:00`);

            const durationMsDay2 = effectiveCheckOut - nextDayStart;
            const durationMinsDay2 = Math.floor(durationMsDay2 / (1000 * 60));

            let nextDayAttendance = await Attendance.findOne({ userId, date: checkOutDateStr });
            if (!nextDayAttendance) {
                nextDayAttendance = new Attendance({
                    userId,
                    date: checkOutDateStr,
                    checkIn: nextDayStart,
                    checkOut: effectiveCheckOut,
                    duration: durationMinsDay2 > 0 ? durationMinsDay2 : 0,
                    status: 'Present',
                    adminId: attendance.adminId,
                    shifts: [{ checkIn: nextDayStart, checkOut: effectiveCheckOut, duration: durationMinsDay2 > 0 ? durationMinsDay2 : 0 }]
                });
            } else {
                nextDayAttendance.checkIn = nextDayStart;
                nextDayAttendance.checkOut = effectiveCheckOut;
                nextDayAttendance.duration = (nextDayAttendance.duration || 0) + (durationMinsDay2 > 0 ? durationMinsDay2 : 0);
                nextDayAttendance.status = 'Present';
                if (!nextDayAttendance.shifts) nextDayAttendance.shifts = [];
                nextDayAttendance.shifts.push({ checkIn: nextDayStart, checkOut: effectiveCheckOut, duration: durationMinsDay2 > 0 ? durationMinsDay2 : 0 });
            }
            await nextDayAttendance.save();
            
            attendance = nextDayAttendance; // Return the most recent one
        } else {
            // Same day checkout
            const durationMs = effectiveCheckOut - checkInTime;
            const durationMins = Math.floor(durationMs / (1000 * 60));
            attendance.checkOut = effectiveCheckOut;
            attendance.duration = (attendance.duration || 0) + (durationMins > 0 ? durationMins : 0);
            attendance.status = 'Present';
            // Update last open shift entry if it exists, otherwise push a new one
            if (!attendance.shifts) attendance.shifts = [];
            const lastShiftEntry = attendance.shifts[attendance.shifts.length - 1];
            if (lastShiftEntry && !lastShiftEntry.checkOut) {
                lastShiftEntry.checkIn = checkInTime;
                lastShiftEntry.checkOut = effectiveCheckOut;
                lastShiftEntry.duration = durationMins > 0 ? durationMins : 0;
                lastShiftEntry.missed = false;
            } else {
                attendance.shifts.push({
                    checkIn: checkInTime,
                    checkOut: effectiveCheckOut,
                    duration: durationMins > 0 ? durationMins : 0
                });
            }
            await attendance.save();
        }

        res.json({
            message: 'Checked out successfully',
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

        // Find any open shift
        let attendance = await Attendance.findOne({
            userId,
            checkIn: { $ne: null },
            checkOut: null
        }).sort({ checkIn: -1 });

        // If no open shift, return today's calendar record (if any)
        if (!attendance) {
            attendance = await Attendance.findOne({ userId, date: dateStr });
        } else {
            // If there is an open shift, check if it's older than 20 hours
            const twentyHoursAgo = new Date(pktNow.getTime() - (20 * 60 * 60 * 1000));
            if (attendance.checkIn < twentyHoursAgo) {
                // Return today's record instead, because the open one is expired
                attendance = await Attendance.findOne({ userId, date: dateStr });
            }
        }

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

// @desc    Add Custom Attendance (Admin)
// @route   POST /api/attendance/custom
// @access  Private/Admin
const addCustomAttendance = async (req, res) => {
    try {
        const { userId, date, checkIn, checkOut, status } = req.body;
        
        const user = await User.findOne({ _id: userId, adminId: req.adminId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Parse time if provided
        let checkInDate = null;
        let checkOutDate = null;
        if (checkIn) {
            checkInDate = new Date(`${date}T${checkIn}:00+05:00`);
        }
        if (checkOut) {
            checkOutDate = new Date(`${date}T${checkOut}:00+05:00`);
            // If checkout is strictly before checkIn, assume it rolled over to next day
            if (checkInDate && checkOutDate < checkInDate) {
                checkOutDate.setDate(checkOutDate.getDate() + 1);
            }
        }

        if (!checkInDate) return res.status(400).json({ message: 'Check-in time is required' });

        // Helper function to calculate total duration and boundaries from shifts
        const recalculateAttendance = (att) => {
            if (!att.shifts || att.shifts.length === 0) return;
            // Sort shifts by checkIn
            att.shifts.sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn));
            att.checkIn = att.shifts[0].checkIn;
            const lastShift = att.shifts[att.shifts.length - 1];
            att.checkOut = lastShift.checkOut || null;
            
            let totalMins = 0;
            for (const s of att.shifts) {
                if (s.checkIn && s.checkOut) {
                    const dur = Math.floor((new Date(s.checkOut) - new Date(s.checkIn)) / (1000 * 60));
                    s.duration = dur > 0 ? dur : 0;
                    totalMins += s.duration;
                }
            }
            att.duration = totalMins;
        };

        const checkInDateStr = getPKTDateString(checkInDate);
        const checkOutDateStr = checkOutDate ? getPKTDateString(checkOutDate) : checkInDateStr;

        let returnedAttendance;

        if (checkOutDate && checkInDateStr !== checkOutDateStr) {
            // Crosses midnight! Split the hours.
            const midnight = new Date(`${checkInDateStr}T23:59:59.999+05:00`);
            
            const durationMsDay1 = midnight - checkInDate;
            const durationMinsDay1 = Math.floor(durationMsDay1 / (1000 * 60));
            
            // DAY 1
            let attendanceDay1 = await Attendance.findOne({ userId, date: checkInDateStr });
            if (!attendanceDay1) {
                attendanceDay1 = new Attendance({
                    userId, adminId: req.adminId, date: checkInDateStr, status: status || 'Present', isCustom: true, shifts: []
                });
            }
            if (!attendanceDay1.shifts) attendanceDay1.shifts = [];
            attendanceDay1.shifts.push({ checkIn: checkInDate, checkOut: midnight, duration: durationMinsDay1 > 0 ? durationMinsDay1 : 0 });
            attendanceDay1.isCustom = true;
            if (status) attendanceDay1.status = status;
            recalculateAttendance(attendanceDay1);
            await attendanceDay1.save();

            // DAY 2
            const nextDayStart = new Date(`${checkOutDateStr}T00:00:00.000+05:00`);
            
            const durationMsDay2 = checkOutDate - nextDayStart;
            const durationMinsDay2 = Math.floor(durationMsDay2 / (1000 * 60));

            let attendanceDay2 = await Attendance.findOne({ userId, date: checkOutDateStr });
            if (!attendanceDay2) {
                attendanceDay2 = new Attendance({
                    userId, adminId: req.adminId, date: checkOutDateStr, status: status || 'Present', isCustom: true, shifts: []
                });
            }
            if (!attendanceDay2.shifts) attendanceDay2.shifts = [];
            attendanceDay2.shifts.push({ checkIn: nextDayStart, checkOut: checkOutDate, duration: durationMinsDay2 > 0 ? durationMinsDay2 : 0 });
            attendanceDay2.isCustom = true;
            if (status) attendanceDay2.status = status;
            recalculateAttendance(attendanceDay2);
            await attendanceDay2.save();
            
            returnedAttendance = attendanceDay2; // return the last day's attendance
        } else {
            // Same Day (or no checkout yet)
            let attendance = await Attendance.findOne({ userId, date: checkInDateStr });
            if (!attendance) {
                attendance = new Attendance({
                    userId, adminId: req.adminId, date: checkInDateStr, status: status || 'Present', isCustom: true, shifts: []
                });
            }
            if (!attendance.shifts) attendance.shifts = [];
            
            let durationMins = 0;
            if (checkOutDate) {
                durationMins = Math.floor((checkOutDate - checkInDate) / (1000 * 60));
            }
            attendance.shifts.push({
                checkIn: checkInDate,
                checkOut: checkOutDate,
                duration: durationMins > 0 ? durationMins : 0
            });
            
            attendance.isCustom = true;
            if (status) attendance.status = status;
            recalculateAttendance(attendance);
            await attendance.save();
            returnedAttendance = attendance;
        }

        res.status(201).json({ message: 'Attendance recorded successfully', attendance: returnedAttendance });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Get all attendance (Admin)
// @route   GET /api/attendance
// @access  Private/Admin
const getAllAttendance = async (req, res) => {
    try {
        // Trigger reconciliation for all staff in bulk before fetching
        const users = await User.find({ role: { $nin: ['Admin', 'SuperAdmin'] }, adminId: req.adminId });
        await reconcileMultipleUsersAttendance(users);

        const attendance = await Attendance.find({ adminId: req.adminId })
            .populate('userId', 'name employeeId role department offDays')
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
            .populate('userId', 'name employeeId role department offDays')
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

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (user.status === 'Deleted') return res.status(400).json({ message: 'Deleted users cannot mark attendance' });



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
        if (user.status === 'Deleted') {
            return res.status(400).json({ success: false, message: 'Deleted users cannot enroll faces' });
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
        const employees = await User.find({ faceEnrolled: true }).select('_id name faceDescriptors');
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
        const { userId } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (user.status === 'Deleted') return res.status(400).json({ message: 'Deleted users cannot mark attendance' });

        const pktNow = getPKTTime(); // Use server time for security
        const dateStr = getPKTDateString(pktNow);

        const twentyHoursAgo = new Date(pktNow.getTime() - (20 * 60 * 60 * 1000));
        
        // Find an open shift
        let openShift = await Attendance.findOne({
            userId,
            checkIn: { $ne: null },
            checkOut: null
        }).sort({ checkIn: -1 });

        // Check if open shift is older than 20 hours (missed checkout)
        if (openShift && openShift.checkIn < twentyHoursAgo) {
            openShift.status = 'Absent'; // Missed checkout
            await openShift.save();
            openShift = null; // Clear it so we trigger a new check-in below
        }

        // --- REPEAT SCAN (Check-Out) ---
        if (openShift) {
            const checkInTime = new Date(openShift.checkIn);
            let effectiveCheckOut = pktNow;

            const checkInDateStr = getPKTDateString(checkInTime);
            const checkOutDateStr = getPKTDateString(effectiveCheckOut);

            if (checkInDateStr !== checkOutDateStr) {
                // Crosses midnight! Split the hours.
                const midnight = new Date(checkInTime);
                midnight.setHours(23, 59, 59, 999);
                
                const durationMsDay1 = midnight - checkInTime;
                const durationMinsDay1 = Math.floor(durationMsDay1 / (1000 * 60));
                
                openShift.checkOut = midnight;
                openShift.duration = (openShift.duration || 0) + (durationMinsDay1 > 0 ? durationMinsDay1 : 0);
                openShift.status = 'Present';
                openShift.markedByFace = true;
                if (!openShift.shifts) openShift.shifts = [];
                // Update open placeholder if it exists, otherwise push
                const lastFaceShift1 = openShift.shifts[openShift.shifts.length - 1];
                if (lastFaceShift1 && !lastFaceShift1.checkOut) {
                    lastFaceShift1.checkIn = checkInTime;
                    lastFaceShift1.checkOut = midnight;
                    lastFaceShift1.duration = durationMinsDay1 > 0 ? durationMinsDay1 : 0;
                    lastFaceShift1.missed = false;
                } else {
                    openShift.shifts.push({ checkIn: checkInTime, checkOut: midnight, duration: durationMinsDay1 > 0 ? durationMinsDay1 : 0 });
                }
                await openShift.save();

                const nextDayStart = new Date(effectiveCheckOut);
                nextDayStart.setHours(0, 0, 0, 0);

                const durationMsDay2 = effectiveCheckOut - nextDayStart;
                const durationMinsDay2 = Math.floor(durationMsDay2 / (1000 * 60));

                let nextDayAttendance = await Attendance.findOne({ userId, date: checkOutDateStr });
                if (!nextDayAttendance) {
                    nextDayAttendance = new Attendance({
                        userId,
                        date: checkOutDateStr,
                        checkIn: nextDayStart,
                        checkOut: effectiveCheckOut,
                        duration: durationMinsDay2 > 0 ? durationMinsDay2 : 0,
                        status: 'Present',
                        adminId: openShift.adminId,
                        markedByFace: true,
                        shifts: [{ checkIn: nextDayStart, checkOut: effectiveCheckOut, duration: durationMinsDay2 > 0 ? durationMinsDay2 : 0 }]
                    });
                } else {
                    nextDayAttendance.checkIn = nextDayStart;
                    nextDayAttendance.checkOut = effectiveCheckOut;
                    nextDayAttendance.duration = (nextDayAttendance.duration || 0) + (durationMinsDay2 > 0 ? durationMinsDay2 : 0);
                    nextDayAttendance.markedByFace = true;
                    if (!nextDayAttendance.shifts) nextDayAttendance.shifts = [];
                    nextDayAttendance.shifts.push({ checkIn: nextDayStart, checkOut: effectiveCheckOut, duration: durationMinsDay2 > 0 ? durationMinsDay2 : 0 });
                }
                await nextDayAttendance.save();
            } else {
                // Same day checkout
                openShift.checkOut = effectiveCheckOut;
                openShift.status = 'Present';
                openShift.markedByFace = true;
                const regularDurationMs = Math.max(0, effectiveCheckOut - checkInTime);
                const durationMins = Math.floor(regularDurationMs / (1000 * 60));
                openShift.duration = (openShift.duration || 0) + (durationMins > 0 ? durationMins : 0);
                if (!openShift.shifts) openShift.shifts = [];
                // Update open placeholder if it exists, otherwise push
                const lastFaceShift2 = openShift.shifts[openShift.shifts.length - 1];
                if (lastFaceShift2 && !lastFaceShift2.checkOut) {
                    lastFaceShift2.checkIn = checkInTime;
                    lastFaceShift2.checkOut = effectiveCheckOut;
                    lastFaceShift2.duration = durationMins > 0 ? durationMins : 0;
                    lastFaceShift2.missed = false;
                } else {
                    openShift.shifts.push({ checkIn: checkInTime, checkOut: effectiveCheckOut, duration: durationMins > 0 ? durationMins : 0 });
                }
                await openShift.save();
            }

            return res.json({
                action: 'checkout',
                employeeName: user.name,
                checkOutTime: format12h(formatInTimeZone(effectiveCheckOut, 'Asia/Karachi', 'HH:mm')),
                message: 'Checked Out'
            });
        }

        // --- INITIAL SCAN (Check-In) ---
        let todayRecord = await Attendance.findOne({ userId, date: dateStr });
        
        if (!todayRecord) {
            let attendance = new Attendance({
                userId,
                date: dateStr,
                checkIn: pktNow,
                status: 'Present',
                adminId: user.adminId,
                markedByFace: true
            });
            await attendance.save();
        } else {
            // Already checked out today, start new shift
            todayRecord.checkIn = pktNow;
            todayRecord.checkOut = null; // Open new shift
            todayRecord.markedByFace = true;
            await todayRecord.save();
        }

        return res.json({
            action: 'checkin',
            employeeName: user.name,
            checkInTime: format12h(formatInTimeZone(pktNow, 'Asia/Karachi', 'HH:mm')),
            message: 'Checked In'
        });

    } catch (error) {
        console.error('Error in faceCheckIn:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Delete/Unenroll employee face
// @route   DELETE /api/attendance/enroll-face/:userId
// @access  Private/Admin
const unenrollFace = async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.faceDescriptors = [];
        user.faceEnrolled = false;
        await user.save();

        res.json({ success: true, message: 'Face data deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Delete/Unenroll ALL employee faces
// @route   DELETE /api/attendance/enroll-face
// @access  Private/Admin
const unenrollAllFaces = async (req, res) => {
    try {
        // Find all users who have faces enrolled and reset their fields
        await User.updateMany(
            { faceEnrolled: true },
            { $set: { faceDescriptors: [], faceEnrolled: false } }
        );

        res.json({ success: true, message: 'All face data deleted successfully' });
    } catch (error) {
        console.error('Error deleting all faces:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

module.exports = {
    reconcileAttendance,
    reconcileMultipleUsersAttendance,
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
    faceCheckIn,
    addCustomAttendance,
    unenrollFace,
    unenrollAllFaces
};

