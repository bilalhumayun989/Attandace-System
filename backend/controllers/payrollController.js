const Payroll = require('../models/Payroll');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { reconcileAttendance } = require('./attendanceController');

// @desc    Generate/Calculate Payroll for a specific month
// @route   POST /api/payroll/generate
// @access  Private/Admin
// --- CORE LOGIC SERVICE ---
const generatePayrollService = async (adminId, month, cycle, customStart, customEnd) => {
    if (!month && !customStart) throw new Error('Month or Custom Date Range is required');

    const query = { role: { $ne: 'Admin' }, adminId: adminId };
    
    const employees = await User.find(query);
    const payrolls = [];

    // 1. Determine Date Range for the Cycle
    let startDate, endDate;

    if (customStart && customEnd) {
        startDate = new Date(customStart);
        endDate = new Date(customEnd);
    } else {
        const [yearStr, monthStr] = month.split('-');
        const reqYear = parseInt(yearStr, 10);
        const reqMonth = parseInt(monthStr, 10);
        
        let daysInMonth = new Date(reqYear, reqMonth, 0).getDate();

        if (cycle === 7 || cycle === '7') {
            // Cycle 7: 23rd of Prev Month -> 7th of Current Month
            let prevYear = reqYear;
            let prevMonth = reqMonth - 1;
            if (prevMonth === 0) {
                prevMonth = 12;
                prevYear -= 1;
            }
            startDate = new Date(prevYear, prevMonth - 1, 23);
            endDate = new Date(reqYear, reqMonth - 1, 7);
        } else if (cycle === 22 || cycle === '22') {
            // Cycle 22: 8th of Current Month -> 22nd of Current Month
            startDate = new Date(reqYear, reqMonth - 1, 8);
            endDate = new Date(reqYear, reqMonth - 1, 22);
        } else {
            // Default Full Month
            startDate = new Date(reqYear, reqMonth - 1, 1);
            endDate = new Date(reqYear, reqMonth - 1, daysInMonth);
            
            const today = new Date();
            if (today.getFullYear() === reqYear && (today.getMonth() + 1) === reqMonth) {
                endDate = new Date(reqYear, reqMonth - 1, today.getDate());
            } else if (today.getFullYear() < reqYear || (today.getFullYear() === reqYear && (today.getMonth() + 1) < reqMonth)) {
                endDate = new Date(reqYear, reqMonth - 1, 0); // Future
            }
        }
    }

    // Cap the endDate to today so we don't penalize future days if generated early
    const currentToday = new Date();
    currentToday.setHours(0,0,0,0);
    if (endDate > currentToday) {
        endDate = new Date(currentToday);
    }

    if (startDate > endDate) {
        return []; // The cycle hasn't even started yet!
    }

    // Format dates for DB querying
    const startStr = `${startDate.getFullYear()}-${(startDate.getMonth()+1).toString().padStart(2,'0')}-${startDate.getDate().toString().padStart(2,'0')}`;
    const endStr = `${endDate.getFullYear()}-${(endDate.getMonth()+1).toString().padStart(2,'0')}-${endDate.getDate().toString().padStart(2,'0')}`;
    const totalDaysInCycle = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    for (const user of employees) {
        // Reconcile attendance first
        await reconcileAttendance(user._id);

        // Fetch attendance records for the specific cycle range
        const attendanceRecords = await Attendance.find({
            userId: user._id,
            date: { $gte: startStr, $lte: endStr }
        });

        const monthlySalary = user.salary || 0;
        
        let totalAbsents = 0; 
        let actualAbsents = 0; 
        let totalLeavesTaken = 0;
        let absentDeductionAmount = 0;
        let totalEarnedSalary = 0;
        
        let presentDays = 0;
        let offDaysPassed = 0;

        const userOffDays = (user.offDays && user.offDays.length > 0) ? user.offDays : [5]; // Default Friday
        const userJoinDate = new Date(user.createdAt || new Date());
        userJoinDate.setHours(0,0,0,0);
        const dailyBreakdown = [];

        // Iterate through every valid day in the cycle date range
        let loopDate = new Date(startDate);
        
        while (loopDate <= endDate) {
            const day = loopDate.getDate();
            const monthForDay = loopDate.getMonth() + 1;
            const yearForDay = loopDate.getFullYear();
            
            const daysInCurrentLoopMonth = new Date(yearForDay, monthForDay, 0).getDate();
            const perDaySalary = monthlySalary / daysInCurrentLoopMonth;

            const dayStr = day.toString().padStart(2, '0');
            const monthStrLoop = monthForDay.toString().padStart(2, '0');
            const dateString = `${yearForDay}-${monthStrLoop}-${dayStr}`;
            
            const dayOfWeek = loopDate.getDay();
            const isOffDay = userOffDays.includes(dayOfWeek);

            const record = attendanceRecords.find(r => r.date === dateString);

            // Skip days before user joined
            if (loopDate < userJoinDate) {
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            if (isOffDay) {
                offDaysPassed++;
                let dayEarnedSalary = perDaySalary;
                let dayPayLabel = 'Off Day';
                let baseMinutes = 0;

                if (record && record.checkIn && record.checkOut) {
                    baseMinutes = record.duration || 0;
                    dayEarnedSalary = perDaySalary * 1.5;
                    dayPayLabel = 'Off Day (Worked — ×1.5)';
                    presentDays++;
                } else if (record && record.checkIn && !record.checkOut) {
                    dayEarnedSalary = perDaySalary;
                    dayPayLabel = 'Off Day (Missed Checkout)';
                }

                totalEarnedSalary += dayEarnedSalary;
                dailyBreakdown.push({
                    date: dateString,
                    status: dayPayLabel,
                    workMinutes: baseMinutes,
                    earnedSalary: Math.round(dayEarnedSalary)
                });
                loopDate.setDate(loopDate.getDate() + 1);
                continue; 
            }

            // No attendance record at all (absent)
            if (!record) {
                totalAbsents += 1;
                actualAbsents += 1;
                absentDeductionAmount += perDaySalary;
                dailyBreakdown.push({
                    date: dateString,
                    status: 'Absent (No Punch)',
                    workMinutes: 0,
                    earnedSalary: 0
                });
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            // Leave-related statuses
            if (record.status === 'Absent') {
                let isPaidLeave = false;
                if (totalLeavesTaken < (user.leaveQuota || 0)) {
                    totalLeavesTaken += 1;
                    isPaidLeave = true;
                    totalEarnedSalary += perDaySalary;
                } else {
                    totalAbsents += 1;
                    absentDeductionAmount += perDaySalary;
                }
                dailyBreakdown.push({
                    date: dateString,
                    status: isPaidLeave ? 'Paid Leave' : 'Absent',
                    workMinutes: 0,
                    earnedSalary: isPaidLeave ? Math.round(perDaySalary) : 0
                });
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            if (record.status === 'On Leave') {
                totalLeavesTaken += 1;
                totalEarnedSalary += perDaySalary;
                dailyBreakdown.push({
                    date: dateString,
                    status: 'On Leave',
                    workMinutes: 0,
                    earnedSalary: Math.round(perDaySalary)
                });
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            // Working day — apply new bracket-based payment logic
            presentDays++;
            
            let baseMinutes = 0;
            if (record.checkIn && record.checkOut) {
                baseMinutes = record.duration || 0;
            }

            let dayEarnedSalary = 0;
            let dayPayLabel = '';

            if (!record.checkOut) {
                // Missed checkout — treat as absent
                dayEarnedSalary = 0;
                dayPayLabel = 'Missed Checkout';
                totalAbsents += 1;
                absentDeductionAmount += perDaySalary;
            } else if (baseMinutes > 9 * 60) {
                // More than 9 hours worked → count as 12 hours → daily salary × 1.5
                dayEarnedSalary = perDaySalary * 1.5;
                dayPayLabel = 'Present (12h — ×1.5)';
            } else if (baseMinutes > 5 * 60) {
                // More than 5 hours worked → count as full 8 hours → full day salary
                dayEarnedSalary = perDaySalary;
                dayPayLabel = 'Present (Full Day)';
            } else if (baseMinutes > 1 * 60) {
                // More than 1 hour worked → count as 4 hours → half day salary
                dayEarnedSalary = perDaySalary * 0.5;
                dayPayLabel = 'Present (Half Day)';
            } else {
                // Less than or equal to 1 hour — no pay (too short)
                dayEarnedSalary = 0;
                dayPayLabel = 'Present (No Pay — <1hr)';
                totalAbsents += 1;
                absentDeductionAmount += perDaySalary;
            }

            totalEarnedSalary += dayEarnedSalary;

            dailyBreakdown.push({
                date: dateString,
                status: dayPayLabel,
                workMinutes: baseMinutes,
                earnedSalary: Math.round(dayEarnedSalary)
            });
            
            loopDate.setDate(loopDate.getDate() + 1);
        }

        const netSalary = totalEarnedSalary;

        // 6. Create Payroll Record (History tracking)
        const payroll = await Payroll.create({
            userId: user._id,
            month: cycle ? `${month} (Till ${cycle})` : month,
            calculationStartDate: startStr,
            calculationEndDate: endStr,
            salary: monthlySalary,
            payableDays: totalDaysInCycle,
            offDays: offDaysPassed,
            presentDays,
            totalLates: 0,
            totalAbsents,
            actualAbsents,
            dailyBreakdown,
            overtime: { minutes: 0, pay: 0 },
            shortHours: { minutes: 0, pay: 0 },
            deductions: {
                lateDeduction: 0,
                absentDeduction: Math.round(absentDeductionAmount),
                totalDeduction: Math.round(absentDeductionAmount)
            },
            netSalary: Math.round(Math.max(0, netSalary)),
            adminId: adminId
        });

        payrolls.push(payroll);
    }

    return payrolls;
};

// @desc    Generate/Calculate Payroll for a specific month
// @route   POST /api/payroll/generate
// @access  Private/Admin
const generatePayroll = async (req, res) => {
    try {
        const { month, userId, cycle, customStart, customEnd } = req.body;
        
        const payrolls = await generatePayrollService(req.adminId, month, cycle, customStart, customEnd);
        
        // If a specific userId was requested, filter the result before sending
        const finalPayrolls = userId ? payrolls.filter(p => p.userId.toString() === userId.toString()) : payrolls;

        res.json({ message: 'Payroll generated successfully', count: finalPayrolls.length, payrolls: finalPayrolls });
    } catch (error) {
        console.error('Error generating payroll:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Get Payrolls by Month
// @route   GET /api/payroll
// @access  Private/Admin
const getPayrolls = async (req, res) => {
    const { month } = req.query; // YYYY-MM
    try {
        const query = month ? { month: { $regex: `^${month}` }, adminId: req.adminId } : { adminId: req.adminId };
        const payrolls = await Payroll.find(query)
            .populate('userId', 'name employeeId role department')
            .sort({ createdAt: -1 }); // Sort by newest calculation first

        res.json(payrolls);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Update Payroll Status (Admin)
// @route   PUT /api/payroll/:id/status
// @access  Private/Admin
const updatePayrollStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const payroll = await Payroll.findOne({ _id: req.params.id, adminId: req.adminId });

        if (!payroll) {
            return res.status(404).json({ message: 'Payroll record not found' });
        }

        if (status === 'Paid') {
            payroll.paidAt = new Date();
        }
        payroll.status = status || payroll.status;
        await payroll.save();

        res.json({ message: `Payroll marked as ${status}`, payroll });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Delete Payroll Record (Admin)
// @route   DELETE /api/payroll/:id
// @access  Private/Admin
const deletePayroll = async (req, res) => {
    try {
        const payroll = await Payroll.findOneAndDelete({ _id: req.params.id, adminId: req.adminId });

        if (!payroll) {
            return res.status(404).json({ message: 'Payroll record not found' });
        }

        res.json({ message: 'Payroll record deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Delete All Payroll Records for Admin (Admin)
// @route   DELETE /api/payroll/delete-all
// @access  Private/Admin
const deleteAllPayrolls = async (req, res) => {
    try {
        await Payroll.deleteMany({ adminId: req.adminId });
        res.json({ message: 'All payroll records deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

module.exports = {
    generatePayroll,
    getPayrolls,
    updatePayrollStatus,
    deletePayroll,
    deleteAllPayrolls,
    generatePayrollService
};
