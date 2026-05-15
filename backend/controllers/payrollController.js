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

        // Expected Shift Calculation
        let expectedShiftMinutes = 480; // Default 8 hours
        if (user.workingHours && user.workingHours.start && user.workingHours.end) {
            const [startH, startM] = user.workingHours.start.split(':').map(Number);
            const [endH, endM] = user.workingHours.end.split(':').map(Number);
            expectedShiftMinutes = (endH * 60 + endM) - (startH * 60 + startM);
        }

        const monthlySalary = user.salary || 0;
        
        let totalLates = 0;
        let totalAbsents = 0; 
        let actualAbsents = 0; 
        let totalLeavesTaken = 0;
        let totalOvertimeMinutes = 0;
        let totalShortMinutes = 0;
        let absentDeductionAmount = 0;
        let lateDeductionAmount = 0;
        let shortHoursPayDeduction = 0;
        let proRatedBaseSalary = 0;
        let overtimePay = 0;
        
        let presentDays = 0;
        let offDaysPassed = 0;

        const userOffDays = user.offDays || [0]; // Default Sunday
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
            const perMinuteSalary = perDaySalary / expectedShiftMinutes;
            
            const overtimeRatePerMinute = (user.overtimeHourlyRate && user.overtimeHourlyRate > 0)
                ? (user.overtimeHourlyRate / 60)
                : perMinuteSalary;
                
            const shortTimeDeductionRatePerMinute = (user.shortTimeHourlyRate && user.shortTimeHourlyRate > 0)
                ? (user.shortTimeHourlyRate / 60)
                : perMinuteSalary;

            const dayStr = day.toString().padStart(2, '0');
            const monthStrLoop = monthForDay.toString().padStart(2, '0');
            const dateString = `${yearForDay}-${monthStrLoop}-${dayStr}`;
            
            const dayOfWeek = loopDate.getDay();
            const isOffDay = userOffDays.includes(dayOfWeek);

            const record = attendanceRecords.find(r => r.date === dateString);

            // IMPORTANT: Only award base salary and apply penalties if the user has already joined the company
            if (loopDate < userJoinDate) {
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            // Add to base salary for the day (since base assumes 30/actual days)
            proRatedBaseSalary += perDaySalary;

            if (isOffDay) {
                offDaysPassed++;
                let workedOnOffDay = false;
                if (record && record.checkIn && record.checkOut) {
                    // Double Overtime for working on an off-day
                    totalOvertimeMinutes += (record.duration || 0) * 2; 
                    presentDays++;
                    workedOnOffDay = true;
                }
                dailyBreakdown.push({
                    date: dateString,
                    status: 'Off Day' + (workedOnOffDay ? ' (Worked)' : ''),
                    workMinutes: workedOnOffDay ? (record.duration || 0) : 0,
                    earnedSalary: Math.round(perDaySalary) // Off days are paid
                });
                loopDate.setDate(loopDate.getDate() + 1);
                continue; 
            }

            if (!record) {
                // Only penalize missing punches if the date is AFTER their joining date
                if (loopDate >= userJoinDate) {
                    totalAbsents += 1;
                    actualAbsents += 1;
                    absentDeductionAmount += perDaySalary;
                    dailyBreakdown.push({
                        date: dateString,
                        status: 'Absent (No Punch)',
                        workMinutes: 0,
                        earnedSalary: 0
                    });
                }
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            if (record.status === 'Absent') {
                let isPaidLeave = false;
                if (totalLeavesTaken < (user.leaveQuota || 0)) {
                    totalLeavesTaken += 1;
                    isPaidLeave = true;
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
                dailyBreakdown.push({
                    date: dateString,
                    status: 'On Leave',
                    workMinutes: expectedShiftMinutes,
                    earnedSalary: Math.round(perDaySalary)
                });
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            // Working day
            presentDays++;
            let shortageDeductionForThisDay = 0;
            
            let baseMinutes = 0;
            if (record.checkIn && record.checkOut) {
                baseMinutes = record.duration || 0;
            }

            if (baseMinutes < expectedShiftMinutes) {
                let shortage = expectedShiftMinutes - baseMinutes;
                let approvedOTMinutes = 0;
                if (record.overtimeIn && record.overtimeOut && record.overtimeStatus === 'Approved') {
                    approvedOTMinutes = Math.floor((new Date(record.overtimeOut) - new Date(record.overtimeIn)) / (1000 * 60));
                }
                const compensation = Math.min(shortage, approvedOTMinutes);
                const remainingOT = approvedOTMinutes - compensation;
                
                shortage -= compensation;
                totalOvertimeMinutes += remainingOT;

                if (shortage > 0) {
                    totalShortMinutes += shortage;
                    shortHoursPayDeduction += shortage * shortTimeDeductionRatePerMinute;
                    shortageDeductionForThisDay = shortage * shortTimeDeductionRatePerMinute;
                }
            } else {
                const extraInBase = baseMinutes - expectedShiftMinutes;
                let approvedOTMinutes = 0;
                if (record.overtimeIn && record.overtimeOut && record.overtimeStatus === 'Approved') {
                    approvedOTMinutes = Math.floor((new Date(record.overtimeOut) - new Date(record.overtimeIn)) / (1000 * 60));
                }
                totalOvertimeMinutes += (extraInBase + approvedOTMinutes);
            }

            if (record.status === 'Late') {
                totalLates += 1;
            }

            let displayStatus = record.status || 'Present';
            if (record.checkIn && !record.checkOut) {
                displayStatus = 'Missed Checkout';
            }

            // Record daily breakdown
            dailyBreakdown.push({
                date: dateString,
                status: displayStatus,
                workMinutes: baseMinutes,
                earnedSalary: Math.round(Math.max(0, perDaySalary - shortageDeductionForThisDay))
            });
            
            loopDate.setDate(loopDate.getDate() + 1);
        }

        const daysInMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
        lateDeductionAmount = Math.floor(totalLates / 3) * 0.5 * (monthlySalary / daysInMonth); // Late penalty based on general month
        overtimePay = totalOvertimeMinutes * (monthlySalary / daysInMonth / expectedShiftMinutes); // Overtime pay based on general month


        const totalDeduction = lateDeductionAmount + absentDeductionAmount + shortHoursPayDeduction;
        const netSalary = proRatedBaseSalary - totalDeduction + overtimePay;

        // 6. Create Payroll Record (History tracking)
        const payroll = await Payroll.create({
            userId: user._id,
            month: cycle ? `${month} (Till ${cycle})` : month,
            calculationStartDate: startStr,
            calculationEndDate: endStr,
            salary: monthlySalary,
            totalDays: daysInMonth, // Deprecated conceptually but kept for schema
            daysInMonth: daysInMonth, 
            payableDays: totalDaysInCycle, // Total days calculated in this loop
            offDays: offDaysPassed,
            presentDays,
            totalLates,
            totalAbsents,
            actualAbsents,
            dailyBreakdown,
            overtime: {
                minutes: Math.round(totalOvertimeMinutes),
                pay: Math.round(overtimePay)
            },
            shortHours: {
                minutes: Math.round(totalShortMinutes),
                pay: Math.round(shortHoursPayDeduction)
            },
            deductions: {
                lateDeduction: Math.round(lateDeductionAmount),
                absentDeduction: Math.round(absentDeductionAmount),
                totalDeduction: Math.round(totalDeduction)
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
