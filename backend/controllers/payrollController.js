const Payroll = require('../models/Payroll');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { reconcileAttendance } = require('./attendanceController');

// @desc    Generate/Calculate Payroll for a specific month
// @route   POST /api/payroll/generate
// @access  Private/Admin
const generatePayroll = async (req, res) => {
    const { month, userId } = req.body; // YYYY-MM

    if (!month) {
        return res.status(400).json({ message: 'Month is required (YYYY-MM)' });
    }

    try {
        const query = { role: { $ne: 'Admin' }, adminId: req.adminId };
        if (userId) {
            query._id = userId;
        }
        
        const employees = await User.find(query);
        const payrolls = [];

        for (const user of employees) {
            // 1. Reconcile attendance first to ensure accuracy
            await reconcileAttendance(user._id);

            // 2. Fetch attendance records for the month
            const attendanceRecords = await Attendance.find({
                userId: user._id,
                date: { $regex: `^${month}` }
            });

            const totalLates = attendanceRecords.filter(r => r.status === 'Late' || r.status === 'Short Hours').length;
            const presentDays = attendanceRecords.filter(r => r.status === 'Present' || r.status === 'Late' || r.status === 'Short Hours').length;

            // Absence Rule: Skip Off-Days
            let totalAbsents = 0;
            let totalLeavesTaken = 0;
            const userOffDays = user.offDays || [0]; // Default Sunday
            
            attendanceRecords.forEach(r => {
                const dateObj = new Date(r.date);
                const dayOfWeek = dateObj.getDay();

                if (r.status === 'Absent') {
                    // Only count as absent if it's NOT an off-day
                    if (!userOffDays.includes(dayOfWeek)) {
                        if (totalLeavesTaken < (user.leaveQuota || 0)) {
                            totalLeavesTaken += 1; // Used a leave quota
                        } else {
                            // Saturday/Monday Absence Rule: Counts as 3 absences each if it's a working day
                            // (User specifically mentioned Sat/Mon rule before, keeping it for working days)
                            if (dayOfWeek === 1 || dayOfWeek === 6) { 
                                totalAbsents += 3;
                            } else {
                                totalAbsents += 1;
                            }
                        }
                    }
                } else if (r.status === 'On Leave') {
                    totalLeavesTaken += 1;
                }
            });

            // 3. Calculate Shift Duration (Expected)
            const [startH, startM] = user.workingHours.start.split(':').map(Number);
            const [endH, endM] = user.workingHours.end.split(':').map(Number);
            const expectedShiftMinutes = (endH * 60 + endM) - (startH * 60 + startM);
            const standardDays = 30;

            // 4. Calculate Overtime & Short Hours (Actual Minutes vs Expected Minutes)
            let totalOvertimeMinutes = 0;
            let totalShortMinutes = 0;
            attendanceRecords.forEach(r => {
                // Base Shift Calculation
                let baseMinutes = 0;
                if (r.checkIn && r.checkOut) {
                    baseMinutes = r.duration || 0;
                }

                // Approved Overtime Calculation
                let approvedOTMinutes = 0;
                if (r.overtimeIn && r.overtimeOut && r.overtimeStatus === 'Approved') {
                    approvedOTMinutes = Math.floor((new Date(r.overtimeOut) - new Date(r.overtimeIn)) / (1000 * 60));
                }

                // Logic: OT first covers Short Hours
                if (baseMinutes < expectedShiftMinutes) {
                    const shortage = expectedShiftMinutes - baseMinutes;
                    const compensation = Math.min(shortage, approvedOTMinutes);
                    
                    const adjustedBase = baseMinutes + compensation;
                    const remainingOT = approvedOTMinutes - compensation;

                    if (adjustedBase < expectedShiftMinutes) {
                        totalShortMinutes += (expectedShiftMinutes - adjustedBase);
                    }
                    totalOvertimeMinutes += remainingOT;
                } else {
                    // Base is already complete or exceeded
                    // Any extra time in base duration (staying late before checkout) + specific OT session
                    const extraInBase = baseMinutes > expectedShiftMinutes ? (baseMinutes - expectedShiftMinutes) : 0;
                    totalOvertimeMinutes += (extraInBase + approvedOTMinutes);
                }
            });

            // 5. Calculate Salary, Deductions & Earnings
            const monthlySalary = user.salary || 0;
            const perDaySalary = monthlySalary / standardDays;
            
            // Per Minute Salary
            const perMinuteSalary = perDaySalary / expectedShiftMinutes;
            
            // Overtime: Use extraHourlyRate if set (>0), otherwise use perMinuteSalary
            const overtimeRatePerMinute = (user.extraHourlyRate && user.extraHourlyRate > 0) 
                ? (user.extraHourlyRate / 60) 
                : perMinuteSalary;
            const overtimePay = totalOvertimeMinutes * overtimeRatePerMinute;
            
            // Short Hours: Use shortTimeHourlyRate if set (>0), otherwise use perMinuteSalary
            const shortTimeDeductionRatePerMinute = (user.shortTimeHourlyRate && user.shortTimeHourlyRate > 0)
                ? (user.shortTimeHourlyRate / 60)
                : perMinuteSalary;
            const shortHoursPayDeduction = totalShortMinutes * shortTimeDeductionRatePerMinute;

            // Deduction Logic (Standard):
            // 3 lates = 1 half day (0.5)
            const lateDeductionAmount = Math.floor(totalLates / 3) * 0.5 * perDaySalary;

            // 1 absent = 1 day salary deduction
            const absentDeductionAmount = totalAbsents * perDaySalary;

            const totalDeduction = lateDeductionAmount + absentDeductionAmount + shortHoursPayDeduction;
            const netSalary = monthlySalary - totalDeduction + overtimePay;

            // 6. Update or Create Payroll Record
            const payroll = await Payroll.findOneAndUpdate(
                { userId: user._id, month },
                {
                    userId: user._id,
                    month,
                    salary: monthlySalary,
                    totalDays: standardDays,
                    presentDays,
                    totalLates,
                    totalAbsents,
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
                    adminId: req.adminId
                },
                { upsert: true, new: true }
            );

            payrolls.push(payroll);
        }

        res.json({ message: 'Payroll generated successfully', count: payrolls.length, payrolls });

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
        const query = month ? { month, adminId: req.adminId } : { adminId: req.adminId };
        const payrolls = await Payroll.find(query)
            .populate('userId', 'name employeeId role department')
            .sort({ month: -1 });

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

        payroll.status = status || payroll.status;
        await payroll.save();

        res.json({ message: `Payroll marked as ${status}`, payroll });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

module.exports = {
    generatePayroll,
    getPayrolls,
    updatePayrollStatus
};
