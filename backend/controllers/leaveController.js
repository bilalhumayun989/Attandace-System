const User = require('../models/User');
const Attendance = require('../models/Attendance');

// @desc    Get employees with optional attendance filters
// @route   POST /api/admin-leave/filter
// @access  Private/Admin
const getFilteredEmployees = async (req, res) => {
    try {
        const { offOnSundayOnly, workedWeekend, month, search, department, role } = req.body;
        
        let query = { role: { $ne: 'Admin' }, adminId: req.adminId };
        
        // Basic Filters
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { employeeId: { $regex: search, $options: 'i' } }
            ];
        }
        if (department) query.department = department;
        if (role) query.role = role;

        // Fetch filtered employees
        let employees = await User.find(query).lean();
        
        if (month && (offOnSundayOnly || workedWeekend)) {
            // Need to filter based on attendance
            const startOfMonth = `${month}-01`;
            const endOfMonth = `${month}-31`; 
            
            const attendanceRecords = await Attendance.find({
                adminId: req.adminId,
                date: { $gte: startOfMonth, $lte: endOfMonth }
            }).lean();
            
            // Group attendance by user
            const attendanceByUser = {};
            attendanceRecords.forEach(r => {
                if (!attendanceByUser[r.userId]) attendanceByUser[r.userId] = [];
                attendanceByUser[r.userId].push(r);
            });
            
            employees = employees.filter(emp => {
                const records = attendanceByUser[emp._id.toString()] || [];
                
                if (offOnSundayOnly) {
                    const sundayAbsences = records.filter(r => r.status === 'Absent' && new Date(r.date).getDay() === 0).length;
                    const otherAbsences = records.filter(r => r.status === 'Absent' && new Date(r.date).getDay() !== 0).length;
                    if (sundayAbsences === 0 || otherAbsences > 0) return false;
                }
                
                if (workedWeekend) {
                    const weekendWork = records.filter(r => 
                        (r.status === 'Present' || r.status === 'Late' || r.status === 'Short Hours') &&
                        (new Date(r.date).getDay() === 0 || new Date(r.date).getDay() === 6)
                    ).length;
                    if (weekendWork === 0) return false;
                }
                
                return true;
            });
        }
        
        res.json(employees);
    } catch (error) {
        console.error('Error in getFilteredEmployees:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Bulk update employee leave and salary rules
// @route   PUT /api/admin-leave/bulk-update
// @access  Private/Admin
const bulkUpdateEmployees = async (req, res) => {
    try {
        const { employeeIds, leaveQuota, extraHourlyRate, shortTimeHourlyRate, offDays } = req.body;
        
        if (!employeeIds || !employeeIds.length) {
            return res.status(400).json({ message: 'No employees selected' });
        }
        
        const updateData = {};
        if (leaveQuota !== undefined) updateData.leaveQuota = leaveQuota;
        if (extraHourlyRate !== undefined) updateData.extraHourlyRate = extraHourlyRate;
        if (shortTimeHourlyRate !== undefined) updateData.shortTimeHourlyRate = shortTimeHourlyRate;
        if (offDays !== undefined) updateData.offDays = offDays;
        
        const result = await User.updateMany(
            { _id: { $in: employeeIds }, adminId: req.adminId },
            { $set: updateData }
        );
        
        res.json({ message: 'Employees updated successfully', modifiedCount: result.modifiedCount });
    } catch (error) {
        console.error('Error in bulkUpdateEmployees:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

module.exports = {
    getFilteredEmployees,
    bulkUpdateEmployees
};
