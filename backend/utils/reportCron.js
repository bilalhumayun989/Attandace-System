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
    // Auto-checkout disabled as there are no fixed shift boundaries.
    // Missed checkouts are penalized at payroll generation.
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

const autoGenerateAndSendPayroll = async (cycle, monthOffset = 0) => {
    try {
        console.log(`[Cron] Starting auto payroll generation for cycle ${cycle === 15 ? '1st-15th' : '16th-End'}...`);
        const { generatePayrollService } = require('../controllers/payrollController');
        
        const date = new Date();
        if (monthOffset) {
            date.setMonth(date.getMonth() - monthOffset);
        }
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
            const worksheetName = cycle === 15 ? '1st_to_15th' : '16th_to_End';
            const worksheet = workbook.addWorksheet(`Payroll_${worksheetName}`);

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
                subject: `Auto Payroll Report - Cycle ${cycle === 15 ? '1st-15th' : '16th-End'} (${monthStr})`,
                text: `Hello ${admin.name},\n\nThe automated payroll for the cycle ${cycle === 15 ? '1st to 15th' : '16th to End'} of ${monthStr} has been generated successfully. Please find the detailed Excel report attached.\n\nRegards,\nHRMS Automation`,
                attachments: [
                    {
                        filename: `Payroll_${cycle === 15 ? '1st-15th' : '16th-End'}_${monthStr}.xlsx`,
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

// Auto-Payroll: Run on the 2nd of every month at 2:00 AM PKT (Calculates for 16th-End of Previous Month)
cron.schedule('0 2 2 * *', () => {
    autoGenerateAndSendPayroll(31, 1);
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

// Auto-Payroll: Run on the 17th of every month at 2:00 AM PKT (Calculates for 1st-15th of Current Month)
cron.schedule('0 2 17 * *', () => {
    autoGenerateAndSendPayroll(15, 0);
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

module.exports = { sendDailyReport, runAutoCheckOut, autoGenerateAndSendPayroll };
