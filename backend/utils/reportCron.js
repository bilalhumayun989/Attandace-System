const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const { formatInTimeZone } = require('date-fns-tz');

const getPKTTime = (date = new Date()) => {
    return new Date(formatInTimeZone(date, 'Asia/Karachi', "yyyy-MM-dd'T'HH:mm:ssXXX"));
};

const getPKTDateString = (date = new Date()) => {
    return formatInTimeZone(date, 'Asia/Karachi', 'yyyy-MM-dd');
};

const runAutoCheckOut = async () => {
    try {
        const pktNow = getPKTTime();

        // Find all active attendance records without checkout (any date)
        const activeAttendance = await Attendance.find({
            checkIn: { $exists: true, $ne: null },
            checkOut: null
        }).populate('userId');

        for (const record of activeAttendance) {
            const user = record.userId;
            // Skip if user not found, or if overtime is allowed (they might be working late), or if no working hours set
            if (!user || user.isOvertimeAllowed || !user.workingHours) continue;

            const checkInTime = new Date(record.checkIn);
            
            // Calculate shift end time based on the check-in date
            const shiftEndTime = new Date(formatInTimeZone(checkInTime, 'Asia/Karachi', `yyyy-MM-dd'T'${user.workingHours.end}:00XXX`));
            
            // Handle overnight shifts: if shift end is before shift start, it ends on the next day
            const shiftStartTime = new Date(formatInTimeZone(checkInTime, 'Asia/Karachi', `yyyy-MM-dd'T'${user.workingHours.start}:00XXX`));
            if (shiftEndTime < shiftStartTime) {
                shiftEndTime.setDate(shiftEndTime.getDate() + 1);
            }

            // If current time is past shift end time, perform auto checkout
            if (pktNow >= shiftEndTime) {
                console.log(`[Auto-Checkout] Checking out ${user.name} at ${shiftEndTime}`);
                
                record.checkOut = shiftEndTime;
                
                // Calculate duration in minutes
                const durationMs = shiftEndTime - checkInTime;
                const totalDurationMins = Math.floor(durationMs / (1000 * 60));
                record.duration = totalDurationMins > 0 ? totalDurationMins : 0;
                
                record.markedByFace = false; // System automated

                // Calculate required shift duration
                const [startH, startM] = user.workingHours.start.split(':').map(Number);
                const [endH, endM] = user.workingHours.end.split(':').map(Number);
                let requiredDurationMins = (endH * 60 + endM) - (startH * 60 + startM);
                if (requiredDurationMins < 0) requiredDurationMins += 24 * 60;

                // Update status based on duration
                if (record.duration < requiredDurationMins) {
                    record.status = 'Short Hours';
                } else if (record.status === 'Late' && record.duration >= requiredDurationMins) {
                    record.status = 'Present';
                }

                await record.save();
            }
        }
    } catch (error) {
        console.error('[Cron Error] Auto-checkout failed:', error);
    }
};

const sendDailyReport = async () => {
    try {
        console.log('[Cron] Starting daily report generation...');
        
        // Get yesterday's date string
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = getPKTDateString(yesterday);

        // Fetch all admins
        const admins = await User.find({ role: 'Admin' });
        if (admins.length === 0) {
            console.log('[Cron] No admins found to send report.');
            return;
        }

        // Fetch all attendance for yesterday
        const attendance = await Attendance.find({ date: dateStr }).populate('userId', 'name employeeId department');

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(`Attendance_${dateStr}`);

        worksheet.columns = [
            { header: 'Employee ID', key: 'empId', width: 15 },
            { header: 'Name', key: 'name', width: 25 },
            { header: 'Department', key: 'dept', width: 20 },
            { header: 'Check In', key: 'checkIn', width: 15 },
            { header: 'Check Out', key: 'checkOut', width: 15 },
            { header: 'Duration', key: 'duration', width: 12 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'OT Status', key: 'otStatus', width: 15 },
            { header: 'OT In', key: 'otIn', width: 15 },
            { header: 'OT Out', key: 'otOut', width: 15 },
            { header: 'OT Reject Reason', key: 'otReason', width: 30 },
        ];

        attendance.forEach(r => {
            worksheet.addRow({
                empId: r.userId?.employeeId || 'N/A',
                name: r.userId?.name || 'Unknown',
                dept: r.userId?.department || 'N/A',
                checkIn: r.checkIn ? formatInTimeZone(r.checkIn, 'Asia/Karachi', 'hh:mm a') : '-',
                checkOut: r.checkOut ? formatInTimeZone(r.checkOut, 'Asia/Karachi', 'hh:mm a') : '-',
                duration: r.duration ? `${Math.floor(r.duration / 60)}h ${r.duration % 60}m` : '-',
                status: r.status,
                otStatus: r.overtimeStatus || 'None',
                otIn: r.overtimeIn ? formatInTimeZone(r.overtimeIn, 'Asia/Karachi', 'hh:mm a') : '-',
                otOut: r.overtimeOut ? formatInTimeZone(r.overtimeOut, 'Asia/Karachi', 'hh:mm a') : '-',
                otReason: r.overtimeRejectReason || '-',
            });
        });

        // Styling
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

        const buffer = await workbook.xlsx.writeBuffer();

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        for (const admin of admins) {
            if (!admin.email) continue;
            
            await transporter.sendMail({
                from: `"HRMS Attendance System" <${process.env.EMAIL_USER}>`,
                to: admin.email,
                subject: `Daily Attendance Report - ${dateStr}`,
                text: `Hello ${admin.name},\n\nPlease find attached the daily attendance report for ${dateStr}. This report includes details for Present, Absent, Short Hours, and Overtime status.\n\nRegards,\nHRMS Automation`,
                attachments: [
                    {
                        filename: `Attendance_Report_${dateStr}.xlsx`,
                        content: buffer
                    }
                ]
            });
        }

        console.log(`[Cron] Daily report successfully sent for ${dateStr}`);
    } catch (error) {
        console.error('[Cron Error] Failed to send daily report:', error);
    }
};

const autoGenerateAndSendPayroll = async (cycle) => {
    try {
        console.log(`[Cron] Starting auto payroll generation for cycle Till ${cycle}th...`);
        const { generatePayrollService } = require('../controllers/payrollController');
        
        const date = new Date();
        const monthStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;

        const admins = await User.find({ role: 'Admin' });
        if (admins.length === 0) return;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        for (const admin of admins) {
            // 1. Generate Payroll Data via Service
            const payrolls = await generatePayrollService(admin._id, monthStr, cycle);
            
            if (payrolls.length === 0) continue; // Skip if no employees
            
            // 2. Build Excel Report
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(`Payroll_Cycle_${cycle}`);

            worksheet.columns = [
                { header: 'Employee Name', key: 'name', width: 25 },
                { header: 'Department', key: 'dept', width: 20 },
                { header: 'Base Salary', key: 'base', width: 15 },
                { header: 'Payable Days', key: 'days', width: 15 },
                { header: 'Absents', key: 'absents', width: 10 },
                { header: 'Lates', key: 'lates', width: 10 },
                { header: 'Overtime (hrs)', key: 'ot', width: 15 },
                { header: 'Total Deductions', key: 'deductions', width: 18 },
                { header: 'Net Salary', key: 'net', width: 15 },
            ];

            payrolls.forEach(p => {
                worksheet.addRow({
                    name: p.userId?.name || 'Unknown',
                    dept: p.userId?.department || '-',
                    base: `Rs ${p.salary}`,
                    days: p.payableDays,
                    absents: p.totalAbsents,
                    lates: p.totalLates,
                    ot: p.overtime ? `${Math.floor(p.overtime.minutes / 60)}h ${p.overtime.minutes % 60}m` : '0h 0m',
                    deductions: `Rs ${p.deductions?.totalDeduction || 0}`,
                    net: `Rs ${p.netSalary}`
                });
            });

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            const buffer = await workbook.xlsx.writeBuffer();

            // 3. Email Admin
            if (!admin.email) continue;
            
            await transporter.sendMail({
                from: `"HRMS Payroll Auto-Generator" <${process.env.EMAIL_USER}>`,
                to: admin.email,
                subject: `Auto Payroll Report - Cycle Till ${cycle}th (${monthStr})`,
                text: `Hello ${admin.name},\n\nThe automated payroll for the cycle till the ${cycle}th of ${monthStr} has been generated successfully. Please find the detailed Excel report attached.\n\nRegards,\nHRMS Automation`,
                attachments: [
                    {
                        filename: `Payroll_Cycle_${cycle}_${monthStr}.xlsx`,
                        content: buffer
                    }
                ]
            });
            console.log(`[Cron] Auto payroll emailed to admin: ${admin.email}`);
        }
    } catch (error) {
        console.error('[Cron Error] Failed to generate/send auto payroll:', error);
    }
};

// Schedule to run every 5 minutes for auto-checkout
cron.schedule('*/5 * * * *', () => {
    runAutoCheckOut();
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

// Schedule to run every day at 12:05 AM Asia/Karachi time
cron.schedule('5 0 * * *', () => {
    sendDailyReport();
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

// Auto-Payroll: Run on the 7th of every month at 2:00 AM PKT
cron.schedule('0 2 7 * *', () => {
    autoGenerateAndSendPayroll(7);
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

// Auto-Payroll: Run on the 22nd of every month at 2:00 AM PKT
cron.schedule('0 2 22 * *', () => {
    autoGenerateAndSendPayroll(22);
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

module.exports = { sendDailyReport, runAutoCheckOut, autoGenerateAndSendPayroll };
