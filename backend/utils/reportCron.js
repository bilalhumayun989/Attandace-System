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

// A write to the same employee serializes cron and fingerprint transactions across
// Node processes, including concurrent first check-ins on different workdays.
const withAttendanceTransaction = (scope, work) => Attendance.db.transaction(async (session) => {
    const locked = await User.updateOne(
        { _id: scope.userId, adminId: scope.adminId, status: { $ne: 'Deleted' } },
        { $inc: { __v: 1 } }, { session, timestamps: false }
    );
    if (!locked.matchedCount) throw new Error('Attendance employee is no longer available.');
    return work(session);
}, { readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });

// Replayed scans use their original time; cron skips recently synchronized records.
const OFFLINE_SYNC_GRACE_MS = 10 * 60 * 1000;
const runAutoCheckOut = async (scope = {}, asOf = null, session = null) => {
    try {
        const pktNow = getPKTTime(asOf || undefined);
        const twentyHoursAgo = new Date(pktNow.getTime() - (20 * 60 * 60 * 1000));
        // Crossing 6 AM does not expire a shift; only the 20-hour limit does.
        const filter = {
            ...scope,
            checkIn: { $ne: null, $lte: twentyHoursAgo },
            checkOut: null,
            status: { $ne: 'On Leave' },
            $expr: { $ne: [{ $arrayElemAt: ['$shifts.missed', -1] }, true] },
            ...(asOf ? {} : { $and: [{ $or: [
                { updatedAt: { $exists: false } },
                { updatedAt: { $lt: new Date(Date.now() - OFFLINE_SYNC_GRACE_MS) } }
            ] }] })
        };
        const openShifts = await Attendance.find(filter).session(session);
        for (const candidate of openShifts) {
            const close = async (activeSession) => {
                // Re-read after acquiring the employee write lock; a scan may have won.
                const record = await Attendance.findOne({ ...filter, _id: candidate._id }).session(activeSession);
                if (!record) return;
                const start = new Date(record.checkIn);
                const end = new Date(start.getTime() + 20 * 60 * 60 * 1000);
                const endWorkDay = getPKTDateString(new Date(end.getTime() - 6 * 60 * 60 * 1000));
                const boundary = new Date(endWorkDay + 'T06:00:00.000+05:00');
                const finishSession = (attendance, checkIn, checkOut) => {
                    const duration = Math.max(0, Math.floor((checkOut - checkIn) / 60000));
                    const checkInSource = checkIn > start ? 'boundary' : record.checkInSource;
                    const checkOutSource = +checkOut === +end ? 'automatic' : 'boundary';
                    const entry = { checkIn, checkOut, duration, missed: false,
                        checkInSource, checkOutSource, sessionStart: start };
                    if (!attendance.shifts) attendance.shifts = [];
                    const last = attendance.shifts[attendance.shifts.length - 1];
                    if (last && !last.checkOut && !last.missed) Object.assign(last, entry);
                    else attendance.shifts.push(entry);
                    attendance.checkOut = checkOut;
                    attendance.checkOutSource = checkOutSource;
                    attendance.duration = (attendance.duration || 0) + duration;
                    attendance.status = 'Present';
                    attendance.isCheckingOut = false;
                };
                if (start < boundary) {
                    let nextDay = await Attendance.findOne({
                        userId: record.userId, adminId: record.adminId, date: endWorkDay
                    }).session(activeSession);
                    if (!nextDay) nextDay = new Attendance({
                        userId: record.userId, adminId: record.adminId, date: endWorkDay, shifts: []
                    });
                    finishSession(record, start, boundary);
                    nextDay.checkIn = boundary;
                    nextDay.checkInSource = 'boundary';
                    finishSession(nextDay, boundary, end);
                    await record.save({ session: activeSession });
                    await nextDay.save({ session: activeSession });
                } else {
                    finishSession(record, start, end);
                    await record.save({ session: activeSession });
                }
            };
            if (session) await close(session);
            else await withAttendanceTransaction(candidate, close);
        }
    } catch (error) {
        // Let an enclosing scan transaction abort and retry transient conflicts.
        if (session) throw error;
        console.error('[Cron Error] Failed to run auto checkout:', error);
        throw error;
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
            .populate({ path: 'userId', select: 'name employeeId department adminId', match: { status: { $ne: 'Deleted' } } });

        console.log(`[Report] Raw attendance fetched: ${rawAttendance.length} records for dates [${datesToQuery.join(', ')}]`);

        // Select full logical shifts by their original check-in, then join their
        // midnight/workday-boundary segments for reporting. Payroll still reads
        // the stored split records and is not changed here.
        const attendanceInWindow = rawAttendance.filter(r => {
            if (!r.userId) return false;
            return !r.checkIn && datesToQuery.includes(r.date);
        });

        const reportShiftsByKey = new Map();
        for (const record of rawAttendance) {
            if (!record.userId) continue;
            const shifts = Array.isArray(record.shifts) ? record.shifts : [];
            if (shifts.length === 0 && record.checkIn) {
                const start = record.checkIn;
                if (start < windowStart || start >= windowEnd) continue;
                const key = `${record.userId._id}:${+start}`;
                reportShiftsByKey.set(key, {
                    userId: record.userId, checkIn: start, checkOut: record.checkOut || null,
                    duration: record.duration || 0, status: record.status || 'Present', date: record.date
                });
                continue;
            }

            for (const shift of shifts) {
                const originalStart = shift.sessionStart || shift.checkIn;
                if (!originalStart || originalStart < windowStart || originalStart >= windowEnd) continue;
                const key = `${record.userId._id}:${+originalStart}`;
                let reportShift = reportShiftsByKey.get(key);
                if (!reportShift) {
                    reportShift = { userId: record.userId, checkIn: originalStart, checkOut: null,
                        duration: 0, status: record.status || 'Present', hasRealCheckOut: false, date: record.date };
                    reportShiftsByKey.set(key, reportShift);
                }
                if (+shift.checkIn === +originalStart) reportShift.date = record.date;
                reportShift.duration += shift.duration || 0;

                // A boundary is only an accounting split. Prefer the actual
                // checkout punch from the segment that closes the logical shift.
                if (shift.checkOut) {
                    const isRealCheckOut = shift.checkOutSource !== 'boundary';
                    if (isRealCheckOut && (!reportShift.hasRealCheckOut || shift.checkOut > reportShift.checkOut)) {
                        reportShift.checkOut = shift.checkOut;
                        reportShift.hasRealCheckOut = true;
                    } else if (!reportShift.hasRealCheckOut &&
                        (!reportShift.checkOut || shift.checkOut > reportShift.checkOut)) {
                        reportShift.checkOut = shift.checkOut;
                    }
                }
            }
        }

        const allAttendance = [...reportShiftsByKey.values(), ...attendanceInWindow];
        console.log(`[Report] After logical shift window filter: ${allAttendance.length} rows.`);

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

            // Count employees once, even when the employee has multiple shifts.
            const presentEmployeeIds = new Set();
            const absentEmployeeIds = new Set();
            const reportEmployeeIds = new Set();
            const dailyCounts = new Map();
            for (const row of tenantAttendance) {
                const employeeId = row.userId?._id?.toString();
                if (!employeeId) continue;
                reportEmployeeIds.add(employeeId);
                if (row.checkIn) presentEmployeeIds.add(employeeId);
                if (row.status === 'Absent') absentEmployeeIds.add(employeeId);

                const attendanceDate = row.date || getPKTDateString(row.checkIn);
                if (!dailyCounts.has(attendanceDate)) {
                    dailyCounts.set(attendanceDate, { present: new Set(), absent: new Set() });
                }
                const day = dailyCounts.get(attendanceDate);
                if (row.checkIn) day.present.add(employeeId);
                if (row.status === 'Absent') day.absent.add(employeeId);
            }
            // A present employee cannot also be counted absent if they have
            // multiple records inside this report window.
            for (const employeeId of presentEmployeeIds) absentEmployeeIds.delete(employeeId);
            dailyCounts.forEach(day => day.present.forEach(employeeId => day.absent.delete(employeeId)));
            const totalPresent = presentEmployeeIds.size;
            const totalAbsent = absentEmployeeIds.size;
            const totalEmployees = reportEmployeeIds.size;

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
                { key: 'empId',    width: 15 },
                { key: 'name',     width: 25 },
                { key: 'dept',     width: 20 },
                { key: 'checkIn',  width: 22 },
                { key: 'checkOut', width: 22 },
                { key: 'duration', width: 12 },
                { key: 'status',   width: 15 },
            ];

            // Put period totals and date-by-date totals above the attendance rows.
            worksheet.addRow([`Employees in period: ${totalEmployees}`, `Present in period (unique): ${totalPresent}`, `Absent in period (unique): ${totalAbsent}`]);
            worksheet.addRow(['Daily totals']);
            worksheet.addRow(['Attendance date', 'Present', 'Absent']);
            [...dailyCounts.entries()].sort(([dateA], [dateB]) => dateA.localeCompare(dateB)).forEach(([date, day]) => {
                worksheet.addRow([date, day.present.size, day.absent.size]);
            });
            worksheet.addRow([]);
            const tableHeaderRow = worksheet.addRow(['Employee ID', 'Name', 'Department', 'Check In', 'Check Out', 'Duration', 'Status']).number;

            tenantAttendance.forEach(r => {
                worksheet.addRow({
                    empId:    r.userId?.employeeId || 'N/A',
                    name:     r.userId?.name       || 'Unknown',
                    dept:     r.userId?.department || 'N/A',
                    checkIn:  r.checkIn  ? formatInTimeZone(r.checkIn,  'Asia/Karachi', 'dd-MMM hh:mm a') : '-',
                    checkOut: r.checkOut ? formatInTimeZone(r.checkOut, 'Asia/Karachi', 'dd-MMM hh:mm a') : '-',
                    duration: r.duration ? `${Math.floor(r.duration / 60)}h ${r.duration % 60}m`   : '-',
                    status:   r.status,
                });
            });

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEFE2' } };
            worksheet.getRow(2).font = { bold: true };
            worksheet.getRow(3).font = { bold: true };
            worksheet.getRow(tableHeaderRow).font = { bold: true };
            worksheet.getRow(tableHeaderRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            worksheet.views = [{ state: 'frozen', ySplit: tableHeaderRow }];

            const buffer = await workbook.xlsx.writeBuffer();

            for (const recipient of recipients) {
                await transporter.sendMail({
                    from: `"HRMS Attendance System" <${process.env.EMAIL_USER}>`,
                    to: recipient.email,
                    subject: `Attendance Report - ${dateLabel}`,
                    text: `Hello ${recipient.name},\n\nPlease find attached the attendance report for your employees.\n\nPeriod: ${windowLabel}\nTotal employees in period: ${totalEmployees}\nUnique present in period: ${totalPresent}\nUnique absent in period: ${totalAbsent}\n\nDaily totals (attendance date | present | absent):\n${[...dailyCounts.entries()].sort(([dateA], [dateB]) => dateA.localeCompare(dateB)).map(([date, day]) => `${date} | ${day.present.size} | ${day.absent.size}`).join('\n')}\n\nRegards,\nHRMS Automation`,
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
                if (!p.userId || p.userId.status === 'Deleted') return;
                worksheet.addRow({
                    name:       p.userId.name,
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
    runAutoCheckOut().catch(error => console.error('[Cron Error]', error));
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

// Schedule to run every day at 7:00 AM PKT
cron.schedule('0 7 * * *', () => {
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

module.exports = { sendDailyReport, runAutoCheckOut, autoGenerateAndSendPayroll, withAttendanceTransaction };
