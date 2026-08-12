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

        // Only find shifts that are still open (not yet marked Absent) and older than 20 hours
        const openShifts = await Attendance.find({
            checkIn: { $ne: null, $lt: twentyHoursAgo },
            checkOut: null,
            status: { $nin: ['Absent', 'On Leave'] } // skip already processed records
        });

        if (openShifts.length > 0) {
            console.log(`[Cron] Found ${openShifts.length} open shifts older than 20 hours. Processing...`);
            for (const record of openShifts) {
                // Check if they had a completed shift earlier in the day
                const hasCompletedShifts = record.shifts && record.shifts.some(s => s.checkOut);
                record.status = hasCompletedShifts ? 'Present' : 'Absent';
                
                // Flag the last open shift entry as missed
                if (record.shifts && record.shifts.length > 0) {
                    const lastEntry = record.shifts[record.shifts.length - 1];
                    if (lastEntry && !lastEntry.checkOut) {
                        lastEntry.missed = true;
                    }
                }

                // Close the open shift so it isn't picked up again
                record.checkOut = record.checkIn; 
                record.isCheckingOut = false;
                await record.save();
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

        // --- FETCH TENANT ROOTS ---
        // Both 'Admin' and 'SuperAdmin' can be tenant roots (owner accounts where adminId == own _id)
        let tenantAdmins;
        if (tenantId) {
            const found = await User.findOne({
                _id: tenantId,
                status: { $ne: 'Deleted' }
            });
            tenantAdmins = found ? [found] : [];
        } else {
            // Fetch all owner accounts — both Admin and SuperAdmin where adminId == their own _id
            const allOwners = await User.find({
                role: { $in: ['Admin', 'SuperAdmin'] },
                status: { $ne: 'Deleted' }
            });
            // Keep only those whose adminId equals their own _id (tenant root accounts)
            tenantAdmins = allOwners.filter(u => u.adminId?.toString() === u._id.toString());
        }
        console.log(`[Report] Found ${tenantAdmins.length} tenant root(s): ${tenantAdmins.map(a => `${a.name} <${a.email || 'NO EMAIL'}> role=${a.role}`).join(', ')}`);

        if (tenantAdmins.length === 0) {
            console.log('[Report] No active admin found for the given tenantId.');
            return { success: false, message: 'No active admin found.' };
        }

        // --- FETCH SUB-SUPERADMINS ---
        // These are SuperAdmins who are NOT tenant roots (adminId != own _id) — sub-accounts under a root
        const adminIds = tenantAdmins.map(a => a._id);
        const subSuperAdmins = await User.find({
            role: 'SuperAdmin',
            status: { $ne: 'Deleted' },
            adminId: { $in: adminIds }
        }).then(list => list.filter(u => u.adminId?.toString() !== u._id.toString()));

        console.log(`[Report] Found ${subSuperAdmins.length} sub-SuperAdmin(s): ${subSuperAdmins.map(s => `${s.name} <${s.email || 'NO EMAIL'}>`).join(', ')}`);

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
        for (const sa of subSuperAdmins) {
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

            // Filter only this tenant's employees
            // Use r.adminId first (direct field), fall back to r.userId.adminId for older records
            const tenantAttendance = allAttendance.filter(r => {
                const recordTid = r.adminId?.toString() || r.userId?.adminId?.toString();
                return recordTid === tid;
            });

            console.log(`[Report] Tenant "${tenantAdminName}" — ${tenantAttendance.length} records, sending to: ${recipients.map(r => r.email).join(', ')}`);

            // Sort by department A->Z, then by employee name A->Z
            tenantAttendance.sort((a, b) => {
                const deptA = (a.userId?.department || '').trim().toLowerCase();
                const deptB = (b.userId?.department || '').trim().toLowerCase();
                if (deptA < deptB) return -1;
                if (deptA > deptB) return 1;
                // Same department, sort by name
                const nameA = (a.userId?.name || '').trim().toLowerCase();
                const nameB = (b.userId?.name || '').trim().toLowerCase();
                return nameA.localeCompare(nameB);
            });

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
        console.log(`[Payroll Cron] Starting auto payroll for cycle ${cycle === 15 ? '1st-15th' : '16th-End'}...`);
        const { generatePayrollService } = require('../controllers/payrollController');

        const date = new Date();
        if (monthOffset) date.setMonth(date.getMonth() - monthOffset);
        const monthStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;

        const cycleLabel    = cycle === 15 ? '1st–15th' : '16th–End';
        const cycleLabelLong = cycle === 15 ? '1st to 15th' : '16th to End';

        // Fetch ALL tenant roots (Admin + SuperAdmin where adminId == own _id)
        const allOwners = await User.find({
            role: { $in: ['Admin', 'SuperAdmin'] },
            status: { $ne: 'Deleted' }
        });
        const tenantRoots = allOwners.filter(u => u.adminId?.toString() === u._id.toString());

        if (tenantRoots.length === 0) {
            console.log('[Payroll Cron] No tenant roots found.');
            return;
        }

        // Fetch all sub-SuperAdmins (adminId != own _id) grouped by their tenant
        const subSuperAdmins = await User.find({
            role: 'SuperAdmin',
            status: { $ne: 'Deleted' }
        }).then(list => list.filter(u => u.adminId?.toString() !== u._id.toString()));

        // Build tenant map: tenantId → { root, recipients[] }
        const tenantMap = {};
        for (const root of tenantRoots) {
            const tid = root._id.toString();
            tenantMap[tid] = { root, recipients: [] };
            if (root.email) tenantMap[tid].recipients.push(root);
        }
        for (const sa of subSuperAdmins) {
            const tid = sa.adminId?.toString();
            if (tid && tenantMap[tid] && sa.email) {
                tenantMap[tid].recipients.push(sa);
            }
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });

        for (const [tid, { root, recipients }] of Object.entries(tenantMap)) {
            if (recipients.length === 0) {
                console.log(`[Payroll Cron] Tenant "${root.name}" has no email recipients — skipping.`);
                continue;
            }

            // Generate payroll using the tenant root's adminId
            const payrolls = await generatePayrollService(root._id, monthStr, cycle);
            if (payrolls.length === 0) {
                console.log(`[Payroll Cron] No employees for tenant "${root.name}" — skipping.`);
                continue;
            }

            await Payroll.populate(payrolls, { path: 'userId', select: 'name department employeeId status' });

            // Build Excel
            const workbook  = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(`Payroll_${cycle === 15 ? '1st_15th' : '16th_End'}`);

            worksheet.columns = [
                { header: 'Employee Name',    key: 'name',       width: 25 },
                { header: 'Department',       key: 'dept',       width: 20 },
                { header: 'Base Salary',      key: 'base',       width: 15 },
                { header: 'Payable Days',     key: 'days',       width: 15 },
                { header: 'Absents',          key: 'absents',    width: 10 },
                { header: 'Lates',            key: 'lates',      width: 10 },
                { header: 'Overtime (hrs)',   key: 'ot',         width: 15 },
                { header: 'Total Deductions', key: 'deductions', width: 18 },
                { header: 'Net Salary',       key: 'net',        width: 15 },
            ];

            payrolls.forEach(p => {
                const deleted = p.userId?.status === 'Deleted' ? ' (Deleted)' : '';
                worksheet.addRow({
                    name:       (p.userId?.name || 'Unknown') + deleted,
                    dept:       p.userId?.department || '-',
                    base:       `Rs ${p.salary}`,
                    days:       p.payableDays,
                    absents:    p.totalAbsents,
                    lates:      p.totalLates,
                    ot:         p.overtime ? `${Math.floor(p.overtime.minutes / 60)}h ${p.overtime.minutes % 60}m` : '0h 0m',
                    deductions: `Rs ${p.deductions?.totalDeduction || 0}`,
                    net:        `Rs ${p.netSalary}`
                });
            });

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            const buffer = await workbook.xlsx.writeBuffer();

            // Send to all recipients of this tenant (Admin + SubSuperAdmins)
            for (const recipient of recipients) {
                await transporter.sendMail({
                    from: `"HRMS Payroll Auto-Generator" <${process.env.EMAIL_USER}>`,
                    to: recipient.email,
                    subject: `Payroll Report — ${cycleLabel} (${monthStr})`,
                    text: `Hello ${recipient.name},\n\nThe automated payroll report for the cycle ${cycleLabelLong} of ${monthStr} has been generated. Please find the Excel report attached.\n\nTotal employees: ${payrolls.length}\n\nRegards,\nHRMS Automation`,
                    attachments: [{
                        filename: `Payroll_${cycleLabel.replace('–', '-')}_${monthStr}.xlsx`,
                        content: buffer
                    }]
                });
                console.log(`[Payroll Cron] Sent to ${recipient.email} [${recipient.role}] — ${payrolls.length} employees`);
            }
        }

        console.log(`[Payroll Cron] Done for cycle ${cycleLabel} (${monthStr}).`);
    } catch (error) {
        console.error('[Payroll Cron Error]', error);
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

// Auto-Payroll: 1st of every month at 6:00 AM PKT
// Sends payroll for 16th–End of PREVIOUS month (monthOffset=1)
cron.schedule('0 6 1 * *', () => {
    autoGenerateAndSendPayroll(31, 1);
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

// Auto-Payroll: 16th of every month at 6:00 AM PKT
// Sends payroll for 1st–15th of CURRENT month (monthOffset=0)
cron.schedule('0 6 16 * *', () => {
    autoGenerateAndSendPayroll(15, 0);
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

module.exports = { sendDailyReport, runAutoCheckOut, autoGenerateAndSendPayroll };
