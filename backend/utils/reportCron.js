const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Payroll = require('../models/Payroll');
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
        const twentyHoursAgo = new Date(pktNow.getTime() - (20 * 60 * 60 * 1000));

        // Find all shifts where checkIn is older than 20 hours and checkOut is still null
        const openShifts = await Attendance.find({
            checkIn: { $ne: null, $lt: twentyHoursAgo },
            checkOut: null
        });

        if (openShifts.length > 0) {
            console.log(`[Cron] Found ${openShifts.length} open shifts older than 20 hours. Marking as Absent/Missed Checkout.`);
            for (const shift of openShifts) {
                shift.status = 'Absent'; // Mark as absent
                shift.isCheckingOut = false;
                // Leave checkOut as null, or set it to checkIn? 
                // The user requested: "his attendance marked as missed checked out and he marked as abent"
                // Leaving checkOut as null and status as 'Absent' will cause payroll to see it as Missed Checkout/Absent.
                await shift.save();
            }
        }
    } catch (error) {
        console.error('[Cron Error] Failed to run auto checkout:', error);
    }
};

const sendDailyReport = async () => {
    try {
        console.log('[Cron] Starting daily report generation...');

        // Window: yesterday 6:00 AM PKT → today 6:00 AM PKT (the moment this cron runs)
        const now = getPKTTime();                         // today 6:00 AM PKT (approx)
        const windowEnd = new Date(now);
        const windowStart = new Date(now);
        windowStart.setDate(windowStart.getDate() - 1);  // exactly 24 hours back

        const yesterdayStr = getPKTDateString(windowStart);
        const todayStr     = getPKTDateString(windowEnd);

        // Label for subject / filename covers both dates if they differ
        const dateLabel = yesterdayStr === todayStr
            ? yesterdayStr
            : `${yesterdayStr}_to_${todayStr}`;

        // Fetch all admins
        const admins = await User.find({ role: 'Admin' });
        if (admins.length === 0) {
            console.log('[Cron] No admins found to send report.');
            return;
        }

        // Fetch records whose date string falls in either day of the window,
        // then filter by checkIn falling within [windowStart, windowEnd]
        const rawAttendance = await Attendance.find({
            date: { $in: [yesterdayStr, todayStr] }
        }).populate('userId', 'name employeeId department');

        // Keep only records where checkIn is within the 6-to-6 window
        // (records with no checkIn — e.g. absent — are included if their date == yesterdayStr)
        const attendance = rawAttendance.filter(r => {
            if (r.checkIn) {
                return r.checkIn >= windowStart && r.checkIn < windowEnd;
            }
            // Absent/no-checkIn records: include if they belong to yesterday's date
            return r.date === yesterdayStr;
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(`Attendance_${dateLabel}`);

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
                subject: `Daily Attendance Report - ${dateLabel} (6AM–6AM)`,
                text: `Hello ${admin.name},\n\nPlease find attached the daily attendance report covering the 24-hour window from ${yesterdayStr} 6:00 AM to ${todayStr} 6:00 AM (PKT). This report includes details for Present, Absent, Short Hours, and Overtime status.\n\nRegards,\nHRMS Automation`,
                attachments: [
                    {
                        filename: `Attendance_Report_${dateLabel}.xlsx`,
                        content: buffer
                    }
                ]
            });
        }

        console.log(`[Cron] Daily report successfully sent for window ${yesterdayStr} 6AM → ${todayStr} 6AM`);
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

            // Populate userId to get name and department for the report
            await Payroll.populate(payrolls, { path: 'userId', select: 'name department employeeId status' });
            
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
                const isDeleted = p.userId?.status === 'Deleted' ? ' (Deleted)' : '';
                worksheet.addRow({
                    name: (p.userId?.name || 'Unknown') + isDeleted,
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

// Schedule to run every day at 6:00 AM Asia/Karachi time
cron.schedule('0 6 * * *', () => {
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
