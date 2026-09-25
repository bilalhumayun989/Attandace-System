const Payroll = require('../models/Payroll');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { reconcileAttendance, reconcileMultipleUsersAttendance } = require('./attendanceController');
const { formatInTimeZone } = require('date-fns-tz');

// @desc    Generate/Calculate Payroll for a specific month
// @route   POST /api/payroll/generate
// @access  Private/Admin
// --- CORE LOGIC SERVICE ---
const generatePayrollService = async (adminId, month, cycle, customStart, customEnd) => {
    if (!month && !customStart) throw new Error('Month or Custom Date Range is required');

    const query = { role: { $nin: ['Admin', 'SuperAdmin'] }, adminId: adminId };

    const employees = await User.find(query);
    const payrolls = [];
    const todayDateStr = formatInTimeZone(new Date(), 'Asia/Karachi', 'yyyy-MM-dd');

    // 1. Determine Date Range for the Cycle
    // Work with plain YYYY-MM-DD strings to avoid timezone/time-of-day comparison bugs.
    // Cap is yesterday (today - 1) because today's attendance is not complete yet.
    const nowPKT = new Date(formatInTimeZone(new Date(), 'Asia/Karachi', "yyyy-MM-dd'T'HH:mm:ssXXX"));
    nowPKT.setDate(nowPKT.getDate() - 1);
    const capStr = formatInTimeZone(nowPKT, 'Asia/Karachi', 'yyyy-MM-dd');

    let startStr, endStr;

    if (customStart && customEnd) {
        startStr = customStart;
        endStr   = customEnd;
    } else {
        const [yearStr, monthStr] = month.split('-');
        const reqYear  = parseInt(yearStr, 10);
        const reqMonth = parseInt(monthStr, 10);
        const daysInMonth = new Date(reqYear, reqMonth, 0).getDate();

        const pad = (n) => String(n).padStart(2, '0');
        const y = yearStr;
        const m = pad(reqMonth);

        if (cycle === 15 || cycle === '15') {
            startStr = `${y}-${m}-01`;
            endStr   = `${y}-${m}-15`;
        } else if (cycle === 31 || cycle === '31') {
            startStr = `${y}-${m}-16`;
            endStr   = `${y}-${m}-${pad(daysInMonth)}`;
        } else {
            // Full month
            startStr = `${y}-${m}-01`;
            endStr   = `${y}-${m}-${pad(daysInMonth)}`;
        }
    }

    // Always cap endStr to yesterday — today's attendance is incomplete
    if (endStr > capStr) endStr = capStr;

    if (startStr > endStr) return []; // Hasn't started yet or entirely in the future

    // Convert to Date objects for the loop (use noon to avoid DST issues)
    const startDate = new Date(`${startStr}T12:00:00`);
    const endDate   = new Date(`${endStr}T12:00:00`);
    const totalDaysInCycle = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // Reconcile attendance in bulk for all employees first
    await reconcileMultipleUsersAttendance(employees);

    for (const user of employees) {

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

        // Overtime aggregation
        let totalOvertimeMinutes = 0;
        let totalOvertimePay = 0;

        let presentDays = 0;
        let offDaysPassed = 0;

        const userOffDays = (user.offDays && user.offDays.length > 0) ? user.offDays : [5]; // Default Friday
        const userJoinDate = new Date(user.createdAt || new Date());
        // Normalize to UTC midnight for comparison
        userJoinDate.setUTCHours(0, 0, 0, 0);
        const dailyBreakdown = [];

        let lastWorkingDayStatus = 'Unknown'; // Tracks if the employee was present or absent before an off-day

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
            const labelSuffix = (record && record.isCustom) ? ' (CA)' : '';
            // Custom handling for dates before employee join date
            if (isBeforeJoin) {
                // If admin added attendance before join, count as present; else absent.
                if (record && record.checkIn && record.checkOut) {
                    const worked = record.duration || 0;
                    let dayEarnedSalary = 0;
                    let dayPayLabel = 'Pre-Join Present';
                    let baseMinutes = worked;
                    presentDays++;

                    if (worked > 11 * 60) {
                        dayEarnedSalary = overtimePay;
                        dayPayLabel = 'Pre-Join Present (Overtime Day)';
                        totalOvertimeMinutes += (worked - 11 * 60);
                        totalOvertimePay += overtimePay;
                    } else if (worked > 6 * 60) {
                        dayEarnedSalary = perDaySalary;
                        dayPayLabel = 'Pre-Join Present (Full Day)';
                    } else {
                        dayEarnedSalary = perDaySalary * 0.5;
                        dayPayLabel = 'Pre-Join Present (Half Day)';
                    }
                    totalEarnedSalary += dayEarnedSalary;
                    lastWorkingDayStatus = 'Present';

                    dailyBreakdown.push({
                        date: dateString,
                        status: dayPayLabel + labelSuffix,
                        workMinutes: baseMinutes,
                        baseDaySalary: baseMinutes > 11 * 60 ? 0 : Math.round(dayEarnedSalary),
                        overtimePay: baseMinutes > 11 * 60 ? Math.round(overtimePay) : 0,
                        earnedSalary: Math.round(dayEarnedSalary)
                    });
                } else {
                    // No attendance record → count as absent
                    totalAbsents++;
                    actualAbsents++;
                    absentDeductionAmount += perDaySalary;
                    lastWorkingDayStatus = 'Absent';

                    dailyBreakdown.push({
                        date: dateString,
                        status: 'Pre-Join Absent',
                        workMinutes: 0,
                        baseDaySalary: 0,
                        overtimePay: 0,
                        earnedSalary: 0,
                        deduction: Math.round(perDaySalary)
                    });
                }
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }



            // ── OFF DAY (Friday / Vacation) ──────────────────────────────────
            // Friday always pays daily salary (salary/30) even if absent.
            // Extra pay on top based on hours worked (all using salary/26 rate):
            //   Absent / no show     → salary/30 only
            //   ≤ 4h                 → salary/30 + (salary/26)/2
            //   > 4h  ≤ 8.5h        → salary/30 + salary/26
            //   > 8.5h ≤ 12h        → salary/30 + salary/26 + (salary/26)/2
            //   > 12h               → salary/30 + salary/26 + salary/26
            if (isOffDay && !isBeforeJoin) {
                offDaysPassed++;
                let dayEarnedSalary = perDaySalary; // always paid base even if absent
                let dayPayLabel = 'Off Day (Absent — Base Pay)';
                let baseMinutes = 0;

                if (record && record.checkIn && record.checkOut) {
                    const worked = record.duration || 0;
                    baseMinutes = worked;
                    presentDays++;

                    if (worked > 12 * 60) {
                        dayEarnedSalary = perDaySalary + overtimePay + overtimePay;
                        dayPayLabel = 'Off Day (>12h — Base + OT + OT)';
                        totalOvertimeMinutes += (worked - 12 * 60);
                        totalOvertimePay += overtimePay * 2;
                    } else if (worked > 8.5 * 60) {
                        dayEarnedSalary = perDaySalary + overtimePay + (overtimePay / 2);
                        dayPayLabel = 'Off Day (8.5–12h — Base + OT + OT/2)';
                        totalOvertimeMinutes += (worked - 8.5 * 60);
                        totalOvertimePay += overtimePay * 1.5;
                    } else if (worked > 4 * 60) {
                        dayEarnedSalary = perDaySalary + overtimePay;
                        dayPayLabel = 'Off Day (4–8.5h — Base + OT)';
                        totalOvertimePay += overtimePay;
                    } else {
                        dayEarnedSalary = perDaySalary + (overtimePay / 2);
                        dayPayLabel = 'Off Day (≤4h — Base + OT/2)';
                        totalOvertimePay += overtimePay / 2;
                    }
                }
                lastWorkingDayStatus = 'Present'; // Friday never breaks sandwich rule

                totalEarnedSalary += dayEarnedSalary;
                dailyBreakdown.push({
                    date: dateString,
                    status: dayPayLabel + labelSuffix,
                    workMinutes: baseMinutes,
                    baseDaySalary: Math.round(perDaySalary),
                    overtimePay: Math.round(dayEarnedSalary - perDaySalary),
                    earnedSalary: Math.round(dayEarnedSalary)
                });
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            // ── ABSENT / ON LEAVE → always Rs 0, no paid leave system ──────────
            if (record && (record.status === 'On Leave' || record.status === 'Absent')) {
                totalAbsents += 1;
                actualAbsents += 1;
                absentDeductionAmount += perDaySalary;
                lastWorkingDayStatus = 'Absent';
                dailyBreakdown.push({
                    date: dateString,
                    status: record.status + labelSuffix,
                    workMinutes: 0,
                    baseDaySalary: 0,
                    overtimePay: 0,
                    earnedSalary: 0,
                    deduction: Math.round(perDaySalary)
                });
                loopDate.setDate(loopDate.getDate() + 1);
                continue;
            }

            // ── REGULAR WORKING DAY ──────────────────────────────────────────────
            // No show / missed checkout → Rs 0
            // ≤ 4h        → salary/30 × 0.5  (half day)
            // > 4h ≤ 8.5h → salary/30 × 1    (full day)
            // > 8.5h ≤ 12h→ salary/30 + (salary/26)/2
            // > 12h       → salary/30 + salary/26
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

                if (baseMinutes > 12 * 60) {
                    // > 12h → full day + full OT
                    dayEarnedSalary = perDaySalary + overtimePay;
                    dayPayLabel = 'Present (>12h — Full Day + OT)';
                    totalOvertimeMinutes += (baseMinutes - 12 * 60);
                    totalOvertimePay += overtimePay;
                } else if (baseMinutes > 8.5 * 60) {
                    // > 8.5h ≤ 12h → full day + half OT
                    dayEarnedSalary = perDaySalary + (overtimePay / 2);
                    dayPayLabel = 'Present (8.5–12h — Full Day + OT/2)';
                    totalOvertimeMinutes += (baseMinutes - 8.5 * 60);
                    totalOvertimePay += overtimePay / 2;
                } else if (baseMinutes > 4 * 60) {
                    // > 4h ≤ 8.5h → full day
                    dayEarnedSalary = perDaySalary;
                    dayPayLabel = 'Present (Full Day)';
                } else {
                    // ≤ 4h → half day
                    dayEarnedSalary = perDaySalary * 0.5;
                    dayPayLabel = 'Present (Half Day)';
                }
            }

            if (isAbsent) {
                totalAbsents += 1;
                actualAbsents += 1;
                absentDeductionAmount += perDaySalary;
                lastWorkingDayStatus = 'Absent';
            } else {
                totalEarnedSalary += dayEarnedSalary;
                lastWorkingDayStatus = 'Present';
            }

            dailyBreakdown.push({
                date: dateString,
                status: dayPayLabel + labelSuffix,
                workMinutes: baseMinutes,
                baseDaySalary: isAbsent ? 0 : (baseMinutes > 8.5 * 60 ? Math.round(perDaySalary) : Math.round(dayEarnedSalary)),
                overtimePay: isAbsent ? 0 : (baseMinutes > 8.5 * 60 ? Math.round(dayEarnedSalary - perDaySalary) : 0),
                earnedSalary: Math.round(dayEarnedSalary),
                ...(isAbsent ? { deduction: Math.round(perDaySalary) } : {})
            });

            loopDate.setDate(loopDate.getDate() + 1);
        }

        const netSalary = Math.max(0, Math.round(totalEarnedSalary));
        const payrollData = {
            userId: user._id,
            adminId: adminId,
            month: month || `${startDate.getFullYear()}-${(startDate.getMonth() + 1).toString().padStart(2, '0')}`,
            calculationStartDate: startStr,
            calculationEndDate: endStr,
            salary: monthlySalary,
            totalDays: totalDaysInCycle,
            payableDays: totalDaysInCycle,
            offDays: offDaysPassed,
            workingDays: totalDaysInCycle - offDaysPassed,
            presentDays: presentDays,
            totalAbsents: totalAbsents,
            actualAbsents: actualAbsents,
            totalLeaves: totalLeavesTaken,
            overtime: {
                minutes: totalOvertimeMinutes,
                pay: Math.round(totalOvertimePay)
            },
            deductions: {
                absentDeduction: Math.round(absentDeductionAmount),
                totalDeduction: Math.round(absentDeductionAmount)
            },
            dailyBreakdown: dailyBreakdown,
            netSalary: netSalary,
            status: 'Pending',
            generationDate: todayDateStr
        };

        const existingPayroll = await Payroll.findOne({
            userId: user._id,
            month: payrollData.month,
            adminId: adminId,
            generationDate: todayDateStr
        });

        if (existingPayroll) {
            Object.assign(existingPayroll, payrollData);
            await existingPayroll.save();
            payrolls.push(existingPayroll);
        } else {
            const newPayroll = new Payroll(payrollData);
            await newPayroll.save();
            payrolls.push(newPayroll);
        }
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
        if (!status) {
            return res.status(400).json({ message: 'Status is required' });
        }
        const allowed = ['Paid', 'Draft', 'Pending', 'Processing', 'Completed'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ message: `Invalid status. Allowed: ${allowed.join(', ')}` });
        }
        const payroll = await Payroll.findOne({ _id: req.params.id, adminId: req.adminId });
        if (!payroll) {
            return res.status(404).json({ message: 'Payroll record not found' });
        }
        if (status === 'Paid') {
            payroll.paidAt = new Date();
        }
        payroll.status = status;
        await payroll.save();
        res.json({ message: `Payroll status updated to ${status}`, payroll });
    } catch (error) {
        console.error('Error updating payroll status:', error);
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
