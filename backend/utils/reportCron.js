const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const { formatInTimeZone } = require('date-fns-tz');

const getPKTDateString = (date = new Date()) => {
    return formatInTimeZone(date, 'Asia/Karachi', 'yyyy-MM-dd');
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

// Schedule to run every day at 12:05 AM Asia/Karachi time
cron.schedule('5 0 * * *', () => {
    sendDailyReport();
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

module.exports = { sendDailyReport };
