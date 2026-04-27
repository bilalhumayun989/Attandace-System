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

            // Saturday/Monday Absence Rule: Counts as 3 absences each
            let totalAbsents = 0;
            attendanceRecords.forEach(r => {
                if (r.status === 'Absent') {
                    const day = new Date(r.date).getDay();
                    if (day === 1 || day === 6) { // Monday or Saturday
                        totalAbsents += 3;
                    } else {
                        totalAbsents += 1;
                    }
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
                if (r.checkIn && r.checkOut && r.duration) {
                    const actualMinutes = r.duration; // duration is in minutes
                    if (actualMinutes > expectedShiftMinutes) {
                        totalOvertimeMinutes += (actualMinutes - expectedShiftMinutes);
                    } else if (actualMinutes < expectedShiftMinutes) {
                        totalShortMinutes += (expectedShiftMinutes - actualMinutes);
                    }
                }
            });

            // 5. Calculate Salary, Deductions & Earnings
            const monthlySalary = user.salary || 0;
            const perDaySalary = monthlySalary / standardDays;
            
            // Per Minute Salary
            const perMinuteSalary = perDaySalary / expectedShiftMinutes;
            const overtimePay = totalOvertimeMinutes * perMinuteSalary;
            const shortHoursPayDeduction = totalShortMinutes * perMinuteSalary;

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
