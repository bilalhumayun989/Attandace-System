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

        if (cycle === 15 || cycle === '15') {
            // Cycle 15: 1st of Current Month -> 15th of Current Month
            startDate = new Date(reqYear, reqMonth - 1, 1);
            endDate = new Date(reqYear, reqMonth - 1, 15);
        } else if (cycle === 31 || cycle === '31') {
            // Cycle 31: 16th of Current Month -> End of Current Month
            startDate = new Date(reqYear, reqMonth - 1, 16);
            endDate = new Date(reqYear, reqMonth, 0);
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
    currentToday.setHours(0, 0, 0, 0);
    if (endDate > currentToday) {
        endDate = new Date(currentToday);
    }

    if (startDate > endDate) {
        return []; // The cycle hasn't even started yet!
    }

    // Format dates for DB querying
    const startStr = `${startDate.getFullYear()}-${(startDate.getMonth() + 1).toString().padStart(2, '0')}-${startDate.getDate().toString().padStart(2, '0')}`;
    const endStr = `${endDate.getFullYear()}-${(endDate.getMonth() + 1).toString().padStart(2, '0')}-${endDate.getDate().toString().padStart(2, '0')}`;
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
        // Normalize to UTC midnight for comparison
        userJoinDate.setUTCHours(0, 0, 0, 0);
        const dailyBreakdown = [];

        // Iterate through every valid day in the cycle date range
        let loopDate = new Date(startDate);

        while (loopDate <= endDate) {
            const yearForDay = loopDate.getFullYear();
            const monthForDay = loopDate.getMonth() + 1;
            const day = loopDate.getDate();
            const dayStr = day.toString().padStart(2, '0');
            const monthStrLoop = monthForDay.toString().padStart(2, '0');
            const dateString = `${yearForDay}-${monthStrLoop}-${dayStr}`;

            // Payroll always uses a 30-day salary base
            const perDaySalary = monthlySalary / 30;
            const overtimePay = monthlySalary / 26;

            const dayOfWeek = loopDate.getDay();
            const isRegularOffDay = userOffDays.includes(dayOfWeek);
            const isVacation = user.vacations && user.vacations.includes(dateString);
            const isOffDay = isRegularOffDay || isVacation;
            // Determine if this date is before the employee actually joined.
            const isBeforeJoin = loopDate < userJoinDate;

            // date field is stored as plain "YYYY-MM-DD" string — direct match is safest
            const record = attendanceRecords.find(r => r.date === dateString);
            // Custom handling for dates before employee join date
            if (isBeforeJoin) {
                // If admin added attendance before join, count as present; else absent.
                if (record && record.checkIn && record.checkOut) {
                    // Evaluate as normal present day
                    const worked = record.duration || 0;
                    let dayEarnedSalary = perDaySalary;
                    let dayPayLabel = 'Pre-Join Present';
                    let baseMinutes = worked;
                    presentDays++;

                    if (worked > 11 * 60) {
                        dayEarnedSalary = perDaySalary + overtimePay;
                        dayPayLabel = 'Pre-Join Present (Full Day + Overtime)';
                    } else if (worked > 6 * 60) {
                        dayEarnedSalary = perDaySalary;
                        dayPayLabel = 'Pre-Join Present (Full Day)';
                    } else {
                        dayEarnedSalary = perDaySalary * 0.5;
                        dayPayLabel = 'Pre-Join Present (Half Day)';
                    }
                    totalEarnedSalary += dayEarnedSalary;
                    dailyBreakdown.push({
                        date: dateString,
                        status: dayPayLabel,
                        workMinutes: baseMinutes,
                        earnedSalary: Math.round(dayEarnedSalary)
                    });
                } else {
                    // No attendance record → count as absent
                    totalAbsents++;
                    actualAbsents++;
                    absentDeductionAmount += perDaySalary;
                    dailyBreakdown.push({
                        date: dateString,
                        status: 'Pre-Join Absent',
                        workMinutes: 0,
                        earnedSalary: 0,
                        deduction: Math.round(perDaySalary)
                    });
                }
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }



            // ── OFF DAY ──────────────────────────────────────────────────────────
            // Off day always pays at least a full day (guaranteed floor).
            // If employee works on off day, apply same bracket rules.
            // Working > 11h on an off day also earns overtime on top.
            if (isOffDay && !isBeforeJoin) {
                offDaysPassed++;
                let dayEarnedSalary = perDaySalary; // guaranteed floor
                let dayPayLabel = 'Off Day';
                let baseMinutes = 0;

                if (record && record.checkIn && record.checkOut) {
                    const worked = record.duration || 0;
                    baseMinutes = worked;
                    presentDays++;

                    if (worked > 11 * 60) {
                        // > 11h → full day pay + overtime bonus
                        dayEarnedSalary = perDaySalary + overtimePay;
                        dayPayLabel = 'Off Day (Worked — Full Day + Overtime)';
                    } else if (worked > 6 * 60) {
                        // > 6h ≤ 11h → full day (same as off-day floor, no extra)
                        dayEarnedSalary = perDaySalary;
                        dayPayLabel = 'Off Day (Worked — Full Day)';
                    } else {
                        // ≤ 6h → half-day work but off-day floor keeps it at full day
                        dayEarnedSalary = perDaySalary;
                        dayPayLabel = 'Off Day (Worked — Half Day, Off Day Rate Applied)';
                    }
                } else if (record && record.checkIn && !record.checkOut) {
                    // Checked in but no checkout on off day — still pay off-day rate
                    dayEarnedSalary = perDaySalary;
                    dayPayLabel = isVacation ? 'Vacation (Missed Checkout)' : 'Off Day (Missed Checkout)';
                }
                // No record at all → default off-day pay already set above

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

            // ── EXPLICIT LEAVE STATUSES ──────────────────────────────────────────
            if (record && record.status === 'On Leave') {
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

            if (record && record.status === 'Absent') {
                // Explicitly marked Absent — check leave quota
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
                    earnedSalary: isPaidLeave ? Math.round(perDaySalary) : 0,
                    deduction: isPaidLeave ? 0 : Math.round(perDaySalary)
                });
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            // ── REGULAR WORKING DAY ──────────────────────────────────────────────
            // Rule 1: No check-in record → Absent (salary = 0)
            // Rule 2: Check-in exists but no check-out → Absent (salary = 0)
            // Rule 3: Both present → evaluate by duration:
            //   ≤ 6h  → Half Day  (50%)
            //   > 6h ≤ 11h → Full Day (100%)
            //   > 11h → Full Day + Overtime
            let dayEarnedSalary = 0;
            let dayPayLabel = '';
            let baseMinutes = 0;
            let isAbsent = false;

            if (!record || !record.checkIn) {
                // No punch at all
                dayEarnedSalary = 0;
                dayPayLabel = 'Absent (No Punch)';
                isAbsent = true;
            } else if (!record.checkOut) {
                // Check-in but no check-out → treat as absent
                dayEarnedSalary = 0;
                dayPayLabel = 'Absent (Missed Checkout)';
                isAbsent = true;
            } else {
                // Full punch — evaluate duration bracket
                baseMinutes = record.duration || 0;
                presentDays++;

                if (baseMinutes > 11 * 60) {
                    dayEarnedSalary = perDaySalary + overtimePay;
                    dayPayLabel = 'Present (Full Day + Overtime)';
                } else if (baseMinutes > 6 * 60) {
                    dayEarnedSalary = perDaySalary;
                    dayPayLabel = 'Present (Full Day)';
                } else {
                    dayEarnedSalary = perDaySalary * 0.5;
                    dayPayLabel = 'Present (Half Day)';
                }
            }

            if (isAbsent) {
                totalAbsents += 1;
                actualAbsents += 1;
                absentDeductionAmount += perDaySalary;
            } else {
                totalEarnedSalary += dayEarnedSalary;
            }

            dailyBreakdown.push({
                date: dateString,
                status: dayPayLabel,
                workMinutes: baseMinutes,
                earnedSalary: Math.round(dayEarnedSalary),
                ...(dayEarnedSalary === 0 && (!record || !record.checkOut) ? { deduction: Math.round(monthlySalary / 30) } : {})
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
            payableDays: 30,
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
