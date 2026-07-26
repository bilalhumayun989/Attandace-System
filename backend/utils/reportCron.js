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

// tenantId: if provided, only sends report for that specific tenant (manual trigger)
// if omitted, sends for ALL tenants (cron job at 6 AM)
const sendDailyReport = async (tenantId = null) => {
    try {
        console.log('[Report] Starting daily report generation...');

        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            throw new Error('EMAIL_USER or EMAIL_PASS not configured in environment variables.');
        }

        // --- WINDOW CALCULATION ---
        const now = new Date(); // real UTC now
        let windowStart, windowEnd, windowLabel, dateLabel, datesToQuery;

        if (tenantId) {
            // Manual trigger: last 24 hours from now
            // e.g. clicked at 3 PM today → yesterday 3 PM → today 3 PM
            windowEnd   = now;
            windowStart = new Date(now.getTime() - (24 * 60 * 60 * 1000));

            const startLabel = formatInTimeZone(windowStart, 'Asia/Karachi', 'yyyy-MM-dd hh:mm a');
            const endLabel   = formatInTimeZone(windowEnd,   'Asia/Karachi', 'yyyy-MM-dd hh:mm a');
            windowLabel = `${startLabel} to ${endLabel} (PKT)`;
            dateLabel   = formatInTimeZone(now, 'Asia/Karachi', 'yyyy-MM-dd');

            // Could span two calendar dates — query both
            const startDateStr = formatInTimeZone(windowStart, 'Asia/Karachi', 'yyyy-MM-dd');
            const endDateStr   = formatInTimeZone(windowEnd,   'Asia/Karachi', 'yyyy-MM-dd');
            datesToQuery = startDateStr === endDateStr ? [startDateStr] : [startDateStr, endDateStr];

            console.log(`[Report] Manual trigger for tenant ${tenantId} — window: ${windowLabel}`);
        } else {
            // Cron: yesterday 6 AM PKT → today 6 AM PKT (fixed window)
            const todayStr = getPKTDateString();
            windowEnd   = new Date(`${todayStr}T06:00:00+05:00`);
            windowStart = new Date(windowEnd.getTime() - (24 * 60 * 60 * 1000));

            const yesterdayStr = formatInTimeZone(windowStart, 'Asia/Karachi', 'yyyy-MM-dd');
            dateLabel   = `${yesterdayStr}_to_${todayStr}`;
            windowLabel = `${yesterdayStr} 6:00 AM to ${todayStr} 6:00 AM (PKT)`;
            datesToQuery = [yesterdayStr, todayStr];

            console.log(`[Report] Cron window: ${windowLabel}`);
        }

        // --- FETCH ADMINS ---
        const adminQuery = {
            role: 'Admin',
            status: { $ne: 'Deleted' },
            ...(tenantId && { _id: tenantId })
        };
        const tenantAdmins = await User.find(adminQuery);
        console.log(`[Report] Found ${tenantAdmins.length} admin tenant(s): ${tenantAdmins.map(a => `${a.name} (${a.email || 'NO EMAIL'})`).join(', ')}`);

        if (tenantAdmins.length === 0) {
            console.log('[Report] No active admin found for the given tenantId.');
            return { success: false, message: 'No active admin found.' };
        }

        // --- FETCH SUPERADMINS ---
        const superAdminQuery = {
            role: 'SuperAdmin',
            status: { $ne: 'Deleted' },
            ...(tenantId && { adminId: tenantId })
        };
        const superAdmins = await User.find(superAdminQuery);
        console.log(`[Report] Found ${superAdmins.length} SuperAdmin(s).`);

        // --- BUILD TENANT MAP: tid → { recipients[], tenantAdminName } ---
        const tenantMap = {};
        for (const admin of tenantAdmins) {
            const tid = admin._id.toString();
            tenantMap[tid] = { recipients: [], tenantAdminName: admin.name };
            if (admin.email) {
                tenantMap[tid].recipients.push(admin);
            } else {
                console.log(`[Report] WARNING: Admin "${admin.name}" has no email — will not receive report.`);
            }
        }
        for (const sa of superAdmins) {
            const tid = sa.adminId?.toString();
            if (tid && tenantMap[tid] && sa.email) {
                tenantMap[tid].recipients.push(sa);
            }
        }

        // --- FETCH ATTENDANCE ---
        // Use Attendance.adminId directly (stored on each record) — more reliable than userId.adminId populate
        const attendanceQuery = { date: { $in: datesToQuery } };
        if (tenantId) {
            // For manual trigger scope to this tenant's records only
            attendanceQuery.adminId = tenantId;
        }

        const rawAttendance = await Attendance.find(attendanceQuery)
            .populate('userId', 'name employeeId department adminId');

        console.log(`[Report] Raw attendance fetched: ${rawAttendance.length} records for dates [${datesToQuery.join(', ')}]`);

        // Filter records whose checkIn falls inside the window
        // Absent records (no checkIn) — include if their date falls within the window's date range
        const allAttendance = rawAttendance.filter(r => {
            if (r.checkIn) {
                return r.checkIn >= windowStart && r.checkIn < windowEnd;
            }
            // No checkIn (absent) — include if the record date is in our query range
            return datesToQuery.includes(r.date);
        });

        console.log(`[Report] After window filter: ${allAttendance.length} records.`);

        // --- SEND EMAILS ---
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        let sentCount = 0;
        const sentLog = [];

        for (const [tid, { recipients, tenantAdminName }] of Object.entries(tenantMap)) {
            if (recipients.length === 0) {
                console.log(`[Report] Tenant "${tenantAdminName}" — no email address on record, skipping.`);
                continue;
            }

            // Filter only this tenant's employees using Attendance.adminId (direct field on record)
            const tenantAttendance = allAttendance.filter(r =>
                r.adminId?.toString() === tid
            );

            console.log(`[Report] Tenant "${tenantAdminName}" — ${tenantAttendance.length} records, sending to: ${recipients.map(r => r.email).join(', ')}`);

            // Build Excel (even if 0 records — send empty sheet so admin knows no activity)
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(`Attendance_${dateLabel}`);

            worksheet.columns = [
                { header: 'Employee ID',      key: 'empId',    width: 15 },
                { header: 'Name',             key: 'name',     width: 25 },
                { header: 'Department',       key: 'dept',     width: 20 },
                { header: 'Check In',         key: 'checkIn',  width: 15 },
                { header: 'Check Out',        key: 'checkOut', width: 15 },
                { header: 'Duration',         key: 'duration', width: 12 },
                { header: 'Status',           key: 'status',   width: 15 },
                { header: 'OT Status',        key: 'otStatus', width: 15 },
                { header: 'OT In',            key: 'otIn',     width: 15 },
                { header: 'OT Out',           key: 'otOut',    width: 15 },
                { header: 'OT Reject Reason', key: 'otReason', width: 30 },
            ];

            tenantAttendance.forEach(r => {
                worksheet.addRow({
                    empId:    r.userId?.employeeId || 'N/A',
                    name:     r.userId?.name       || 'Unknown',
                    dept:     r.userId?.department || 'N/A',
                    checkIn:  r.checkIn  ? formatInTimeZone(r.checkIn,  'Asia/Karachi', 'hh:mm a') : '-',
                    checkOut: r.checkOut ? formatInTimeZone(r.checkOut, 'Asia/Karachi', 'hh:mm a') : '-',
                    duration: r.duration ? `${Math.floor(r.duration / 60)}h ${r.duration % 60}m`   : '-',
                    status:   r.status,
                    otStatus: r.overtimeStatus || 'None',
                    otIn:     r.overtimeIn  ? formatInTimeZone(r.overtimeIn,  'Asia/Karachi', 'hh:mm a') : '-',
                    otOut:    r.overtimeOut ? formatInTimeZone(r.overtimeOut, 'Asia/Karachi', 'hh:mm a') : '-',
                    otReason: r.overtimeRejectReason || '-',
                });
            });

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

            const buffer = await workbook.xlsx.writeBuffer();

            for (const recipient of recipients) {
                await transporter.sendMail({
                    from: `"HRMS Attendance System" <${process.env.EMAIL_USER}>`,
                    to: recipient.email,
                    subject: `Attendance Report - ${dateLabel}`,
                    text: `Hello ${recipient.name},\n\nPlease find attached the attendance report for your employees.\n\nPeriod: ${windowLabel}\nTotal records: ${tenantAttendance.length}\n\nRegards,\nHRMS Automation`,
                    attachments: [{
                        filename: `Attendance_Report_${dateLabel}.xlsx`,
                        content: buffer
                    }]
                });
                sentCount++;
                sentLog.push(`${recipient.email} [${recipient.role}] — ${tenantAttendance.length} records`);
                console.log(`[Report] Sent to ${recipient.email} [${recipient.role}] — ${tenantAttendance.length} records`);
            }
        }

        console.log(`[Report] Done. ${sentCount} email(s) sent: ${sentLog.join(' | ')}`);
        return { success: true, sentCount, sentLog, window: windowLabel };

    } catch (error) {
        console.error('[Report Error]', error);
        throw error;
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

// Schedule to run every day at 6:00 AM PKT
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
