// // attendanceFingerprint.routes.js
// //
// // Apne existing Express app mein add karein, jaise:
// //   app.use('/api/attendance', require('./attendanceFingerprint.routes'));
// //
// // NOTE: Employee model mein ek naya field add karna hoga:
// //   fingerprintTemplate: { type: String, default: null }   // base64 string
// //
// // Model names (Employee, Attendance) apne asal project ke naam se badal lein.

// const express = require('express');
// const router = express.Router();
// const Employee = require('../models/User');       // actual path to User model
// const Attendance = require('../models/Attendance');    // actual path to Attendance model

// // ── GET: Kiosk startup pe sab employees ke fingerprint templates dene ke liye ──
// router.get('/fingerprint-templates', async (req, res) => {
//   try {
//     const employees = await Employee.find(
//       { fingerprintTemplate: { $exists: true, $ne: null } },
//       { name: 1, fingerprintTemplate: 1 }
//     );
//     res.json({ employees });
//   } catch (err) {
//     res.status(500).json({ message: 'Failed to load templates', error: err.message });
//   }
// });

// // ── POST: Admin tool se naye employee ka fingerprint template save karna ──
// router.post('/fingerprint-enroll', async (req, res) => {
//   try {
//     const { userId, template } = req.body;
//     if (!userId || !template) {
//       return res.status(400).json({ message: 'userId aur template dono zaroori hain' });
//     }
//     await Employee.findByIdAndUpdate(userId, { fingerprintTemplate: template });
//     res.json({ message: 'Fingerprint enroll ho gaya' });
//   } catch (err) {
//     res.status(500).json({ message: 'Enrollment fail hua', error: err.message });
//   }
// });

// // ── POST: Kiosk se scan ke baad attendance mark karna ──
// // Check-in/check-out khud decide hota hai (aaj ka pehla scan = check-in, agla = check-out)
// // router.post('/fingerprint-checkin', async (req, res) => {
// //   try {
// //     const { userId, timestamp } = req.body;
// //     if (!userId) {
// //       return res.status(400).json({ message: 'userId zaroori hai' });
// //     }

// //     const employee = await Employee.findById(userId);
// //     if (!employee) {
// //       return res.status(404).json({ message: 'Employee nahi mila' });
// //     }

// //     const startOfDay = new Date();
// //     startOfDay.setHours(0, 0, 0, 0);

// //     const todayRecord = await Attendance.findOne({
// //       employee: userId,
// //       date: { $gte: startOfDay }
// //     }).sort({ createdAt: -1 });

// //     const action = (!todayRecord || todayRecord.status === 'checked_out') ? 'checkin' : 'checkout';

// //     const record = await Attendance.create({
// //       employee: userId,
// //       action,
// //       status: action === 'checkin' ? 'checked_in' : 'checked_out',
// //       date: timestamp ? new Date(timestamp) : new Date()
// //     });

// //     res.status(201).json({
// //       message: action === 'checkin'
// //         ? `${employee.name} check-in ho gaya`
// //         : `${employee.name} check-out ho gaya`,
// //       status: record.status,
// //       employeeName: employee.name
// //     });
// //   } catch (err) {
// //     res.status(500).json({ message: 'Attendance mark nahi ho saki', error: err.message });
// //   }
// // });


// // Fingerprint attendance — uses the existing Attendance schema.
// // Date/time comes from the server, not the kiosk timestamp.
// router.post('/fingerprint-checkin', async (req, res) => {
//   try {
//     const { userId } = req.body;

//     if (typeof userId !== 'string' || !/^[a-f\d]{24}$/i.test(userId)) {
//       return res.status(400).json({ message: 'Valid userId zaroori hai' });
//     }

//     const user = await Employee.findById(userId);

//     if (!user) {
//       return res.status(404).json({ message: 'Employee nahi mila' });
//     }

//     if (user.status === 'Deleted') {
//       return res.status(400).json({
//         message: 'Deleted employee attendance mark nahi kar sakta'
//       });
//     }

//     if (!user.adminId) {
//       return res.status(400).json({
//         message: 'Employee ke User record mein adminId missing hai'
//       });
//     }

//     const { formatInTimeZone } = require('date-fns-tz');
//     const now = new Date();
//     const pktDate = date =>
//       formatInTimeZone(date, 'Asia/Karachi', 'yyyy-MM-dd');

//     const today = pktDate(now);
//     const minutesBetween = (start, end) =>
//       Math.max(0, Math.floor((end - start) / 60000));

//     // Complete an existing shift placeholder, or add a completed session.
//     const finishSession = (record, start, end) => {
//       const minutes = minutesBetween(start, end);

//       if (!record.shifts) record.shifts = [];

//       const last = record.shifts[record.shifts.length - 1];

//       if (last && !last.checkOut && !last.missed) {
//         last.checkIn = start;
//         last.checkOut = end;
//         last.duration = minutes;
//         last.missed = false;
//       } else {
//         record.shifts.push({
//           checkIn: start,
//           checkOut: end,
//           duration: minutes,
//           missed: false
//         });
//       }

//       record.checkOut = end;
//       record.duration = (record.duration || 0) + minutes;
//       record.status = 'Present';

//       // Existing markedByFace value is deliberately preserved.
//     };

//     let open = await Attendance.findOne({
//       userId,
//       checkIn: { $ne: null },
//       checkOut: null
//     }).sort({ checkIn: -1 });

//     // Close an expired shift so it cannot remain open indefinitely.
//     if (open && now - new Date(open.checkIn) > 20 * 60 * 60 * 1000) {
//       if (!open.shifts) open.shifts = [];

//       const last = open.shifts[open.shifts.length - 1];

//       if (last && !last.checkOut) {
//         last.missed = true;
//       } else {
//         open.shifts.push({
//           checkIn: open.checkIn,
//           duration: 0,
//           missed: true
//         });
//       }

//       open.status = open.shifts.some(s => s.checkOut && !s.missed)
//         ? 'Present'
//         : 'Absent';

//       open.checkOut = open.checkIn;
//       await open.save();
//       open = null;
//     }

//     // An open shift means this scan is a checkout.
//     if (open) {
//       const start = new Date(open.checkIn);
//       const elapsedMinutes = (now - start) / 60000;

//       // Same checkout rule as your face controller.
//       if (elapsedMinutes < 30) {
//         return res.json({
//           action: 'too_soon',
//           status: 'checked_in',
//           employeeName: user.name,
//           message:
//             `Please wait ${Math.ceil(30 - elapsedMinutes)} ` +
//             'more minutes before checking out.'
//         });
//       }

//       if (pktDate(start) === today) {
//         finishSession(open, start, now);
//         await open.save();
//       } else {
//         // Split an overnight shift at midnight PKT.
//         const midnight = new Date(`${today}T00:00:00.000+05:00`);

//         let nextDay = await Attendance.findOne({
//           userId,
//           date: today
//         });

//         if (!nextDay) {
//           nextDay = new Attendance({
//             userId,
//             adminId: user.adminId,
//             date: today,
//             status: 'Present',
//             shifts: []
//           });
//         }

//         finishSession(open, start, midnight);

//         nextDay.checkIn = midnight;
//         finishSession(nextDay, midnight, now);

//         // Validate both records before either write.
//         await open.validate();
//         await nextDay.validate();

//         await open.save();
//         await nextDay.save();
//       }

//       return res.json({
//         action: 'checkout',
//         status: 'checked_out',
//         employeeName: user.name,
//         message: `${user.name} — Checked Out`
//       });
//     }

//     // No open shift: create or reopen today's single attendance record.
//     let attendance = await Attendance.findOne({
//       userId,
//       date: today
//     });

//     // Avoid an immediate accidental check-in after checkout.
//     if (
//       attendance?.checkOut &&
//       now - new Date(attendance.checkOut) < 30000
//     ) {
//       return res.json({
//         action: 'too_soon',
//         status: 'checked_out',
//         employeeName: user.name,
//         message: 'Already checked out. Please wait 30 seconds.'
//       });
//     }

//     if (!attendance) {
//       attendance = new Attendance({
//         userId,
//         adminId: user.adminId,
//         date: today,
//         duration: 0,
//         shifts: []
//       });
//     }

//     attendance.checkIn = now;
//     attendance.checkOut = null;
//     attendance.status = 'Present';

//     if (!attendance.shifts) attendance.shifts = [];

//     attendance.shifts.push({
//       checkIn: now,
//       checkOut: null,
//       duration: 0,
//       missed: false
//     });

//     await attendance.save();

//     return res.status(201).json({
//       action: 'checkin',
//       status: 'checked_in',
//       employeeName: user.name,
//       message: `${user.name} — Checked In`
//     });
//   } catch (error) {
//     console.error('[Fingerprint attendance]', error);

//     if (error.code === 11000) {
//       return res.status(409).json({
//         message: 'Attendance changed during this scan. Please check current status.'
//       });
//     }

//     return res.status(500).json({
//       message: 'Attendance mark nahi ho saki. Server logs check karein.'
//     });
//   }
// });


// module.exports = router;




















'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { formatInTimeZone } = require('date-fns-tz');
const Employee = require('../models/User');
const Attendance = require('../models/Attendance');
const { runAutoCheckOut, withAttendanceTransaction } = require('../utils/reportCron');
const router = express.Router();

// Optional private config created by setup-fingerprint.cjs in this same directory.
// Environment settings, when present, override the corresponding file setting.
// No dotenv dependency and no changes to app.js/server.js are required here.
let fileConfig = {};
try {
  fileConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'fingerprint-kiosk.config.json'), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') console.error('[Fingerprint] Private configuration could not be read.');
}
const config = {
  kioskToken: process.env.HRMS_KIOSK_TOKEN ?? fileConfig.kioskToken,
  enrollToken: process.env.HRMS_ENROLL_TOKEN ?? fileConfig.enrollToken,
  adminId: process.env.HRMS_KIOSK_ADMIN_ID ?? fileConfig.adminId
};
const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const validToken = value => typeof value === 'string' && /^[\x21-\x7e]{32,512}$/.test(value);
const digest = value => crypto.createHash('sha256').update(value).digest();
const sameToken = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const tenantId = validId(config.adminId) ? config.adminId.toLowerCase() : null;

function authenticate(kind) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const expected = kind === 'enroll' ? config.enrollToken : config.kioskToken;
    // The enrollment key must be separate from the kiosk key.
    if (!tenantId || !validToken(expected) ||
        (kind === 'enroll' && (!validToken(config.kioskToken) || sameToken(expected, config.kioskToken)))) {
      return res.status(503).json({ action: 'unavailable', message: 'نظام کی ترتیب مکمل نہیں ہے۔ انتظامیہ سے رابطہ کریں۔' });
    }
    const header = req.headers.authorization;
    const supplied = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!validToken(supplied) || !sameToken(expected, supplied)) {
      return res.status(401).json({ action: 'denied', message: 'اس آلے کو اجازت حاصل نہیں ہے۔ انتظامیہ سے رابطہ کریں۔' });
    }
    next();
  };
}
const kioskAuth = authenticate('kiosk');
const enrollAuth = authenticate('enroll');
const validTemplate = value => typeof value === 'string' && value.length === 536 &&
  /^[A-Za-z0-9+/]+={2}$/.test(value) && Buffer.from(value, 'base64').length === 400 &&
  Buffer.from(value, 'base64').toString('base64') === value;
const denied = res => res.status(404).json({ action: 'denied', message: 'ملازم دستیاب نہیں ہے۔ انتظامیہ سے رابطہ کریں۔' });

// ── Offline kiosk support ──────────────────────────────────────────────────
// While the kiosk has no internet it saves scans locally and replays them later with
//   { userId, clientId, offline: true, scannedAt: "<ISO UTC time of the real scan>" }
// scannedAt is trusted ONLY when offline === true and only inside the limits below.
// clientId is unique per scan; a scan that is already saved is answered with
// action 'duplicate' instead of being recorded twice.
const validClientId = value => typeof value === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(value);
const OFFLINE_MAX_AGE_MS = (Number(process.env.HRMS_OFFLINE_MAX_AGE_HOURS) > 0
  ? Number(process.env.HRMS_OFFLINE_MAX_AGE_HOURS) : 168) * 60 * 60 * 1000; // default 7 days
const CLOCK_AHEAD_TOLERANCE_MS = 10 * 60 * 1000;
function resolveScanTime(body, serverNow) {
  if (body.offline !== true) return { at: serverNow };
  const at = typeof body.scannedAt === 'string' ? new Date(body.scannedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return { error: 'scannedAt is missing or not a valid time.' };
  if (at > serverNow) {
    // A kiosk clock a few minutes ahead is tolerated (scan is stamped "now"); more is refused.
    return at - serverNow <= CLOCK_AHEAD_TOLERANCE_MS
      ? { at: serverNow } : { error: 'scannedAt is in the future.' };
  }
  if (serverNow - at > OFFLINE_MAX_AGE_MS) return { error: 'scannedAt is too old to accept.' };
  return { at };
}

router.get('/fingerprint-templates', kioskAuth, async (req, res) => {
  try {
    const employees = await Employee.find(
      { adminId: tenantId, status: { $ne: 'Deleted' }, fingerprintTemplate: { $type: 'string', $ne: '' } },
      { name: 1, fingerprintTemplate: 1, status: 1 }
    );
    // Keep invalid historical data out of the scanner; it must be re-enrolled by an admin.
    res.json({ employees: employees.filter(employee => validTemplate(employee.fingerprintTemplate)) });
  } catch (error) {
    console.error('[Fingerprint templates]', error);
    res.status(500).json({ message: 'معلومات حاصل نہیں ہو سکیں۔ انتظامیہ سے رابطہ کریں۔' });
  }
});

// This credential belongs ONLY in the administrator's enrollment tool, never in the kiosk.
router.post('/fingerprint-enroll', enrollAuth, async (req, res) => {
  try {
    const { userId, template } = req.body || {};
    if (!validId(userId) || !validTemplate(template)) {
      return res.status(400).json({ message: 'ملازم یا فنگر پرنٹ کی معلومات درست نہیں ہیں۔' });
    }
    const duplicate = await Employee.findOne({
      adminId: tenantId, _id: { $ne: userId }, fingerprintTemplate: template
    });
    if (duplicate) {
      return res.status(409).json({ message: 'یہ فنگر پرنٹ کسی دوسرے ملازم کے لیے درج ہے۔' });
    }
    const employee = await Employee.findOneAndUpdate(
      { _id: userId, adminId: tenantId, status: { $ne: 'Deleted' } },
      { $set: { fingerprintTemplate: template } },
      { new: true, runValidators: true }
    );
    if (!employee) return denied(res);
    res.json({ message: 'فنگر پرنٹ درج ہو گیا ہے۔' });
  } catch (error) {
    console.error('[Fingerprint enrollment]', error);
    res.status(500).json({ message: 'فنگر پرنٹ درج نہیں ہو سکا۔ انتظامیہ سے رابطہ کریں۔' });
  }
});

router.post('/fingerprint-remove', enrollAuth, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!validId(userId)) {
      return res.status(400).json({ message: 'Employee ki maloomat drust nahi hain.' });
    }
    const employee = await Employee.findOneAndUpdate(
      { _id: userId, adminId: tenantId, status: { $ne: 'Deleted' } },
      { $set: { fingerprintTemplate: null } },
      { new: true }
    );
    if (!employee) return denied(res);
    res.json({ message: 'Fingerprint hata diya gaya hai.' });
  } catch (error) {
    console.error('[Fingerprint removal]', error);
    res.status(500).json({ message: 'فنگر پرنٹ درج نہیں ہو سکا۔ انتظامیہ سے رابطہ کریں۔' });
  }
});

// Prevent overlapping fingerprint requests within this Node process.
// Transactions also serialize fingerprint scans and cron across Node processes.
const inFlight = new Set();
router.post('/fingerprint-checkin', kioskAuth, async (req, res) => {
  let lockKey;
  try {
    const { userId, clientId } = req.body || {};
    if (!validId(userId)) return res.status(400).json({ message: 'ملازم کی معلومات درست نہیں ہیں۔' });
    if (clientId !== undefined && !validClientId(clientId)) {
      return res.status(400).json({ action: 'rejected', message: 'clientId is not valid.' });
    }
    const id = userId.toLowerCase();
    if (inFlight.has(id)) {
      return res.status(429).json({ action: 'busy', message: 'حاضری درج ہو رہی ہے۔ کچھ دیر انتظار کریں۔' });
    }
    inFlight.add(id);
    lockKey = id;
    const user = await Employee.findOne({ _id: id, adminId: tenantId, status: { $ne: 'Deleted' } });
    if (!user) return denied(res);
    if (!validTemplate(user.fingerprintTemplate)) {
      return res.status(400).json({ message: 'فنگر پرنٹ درج کروانے کے لیے انتظامیہ سے رابطہ کریں۔' });
    }

    // Live scans use the server clock. A replayed offline scan (offline === true) uses the time
    // the finger was really scanned, after the sanity checks in resolveScanTime.
    const scan = resolveScanTime(req.body || {}, new Date());
    if (scan.error) return res.status(400).json({ action: 'rejected', message: scan.error });
    const now = scan.at;
    const getWorkDay = (date) => {
      const pktHour = parseInt(formatInTimeZone(date, 'Asia/Karachi', 'HH'), 10);
      if (pktHour < 6) {
        const prev = new Date(date);
        prev.setTime(prev.getTime() - (6 * 60 * 60 * 1000));
        return formatInTimeZone(prev, 'Asia/Karachi', 'yyyy-MM-dd');
      }
      return formatInTimeZone(date, 'Asia/Karachi', 'yyyy-MM-dd');
    };
    const today = getWorkDay(now);
    const scope = { userId: id, adminId: user.adminId };
    const reply = await withAttendanceTransaction(scope, async (session) => {
      // Buffer the response until both workdays and the scan id have committed.
      const result = (body, code = 200) => ({ code, body });
      if (clientId && await Attendance.exists({ ...scope, clientIds: clientId }).session(session)) {
        return result({ action: 'duplicate', employeeName: user.name, message: 'Scan was already recorded.' });
      }
      const newerPunch = await Attendance.exists({ ...scope, $or: [
        { checkIn: { $gt: now }, checkInSource: { $ne: 'boundary' } },
        { checkOut: { $gt: now }, checkOutSource: { $nin: ['boundary', 'automatic'] } }
      ] }).session(session);
      if (newerPunch) return result({ action: 'rejected', message: 'Scan predates a newer recorded punch.' }, 409);

      // A real offline OUT may arrive after cron's automatic closure. Replace only
      // that automatic allocation, in this transaction, using the real scan time.
      if ((req.body || {}).offline === true) {
        const automatic = await Attendance.findOne({ ...scope, shifts: { $elemMatch: {
          checkOutSource: 'automatic', sessionStart: { $lte: now }, checkOut: { $gt: now }
        } } }).session(session);
        const autoShift = automatic?.shifts.find(shift => shift.checkOutSource === 'automatic' &&
          shift.sessionStart <= now && shift.checkOut > now);
        if (autoShift) {
          const originalStart = autoShift.sessionStart;
          const elapsedMinutes = (now - originalStart) / 60000;
          if (elapsedMinutes < 30) return result({
            action: 'too_soon', status: 'checked_in', employeeName: user.name,
            retryAfterSeconds: Math.max(1, Math.ceil((30 - elapsedMinutes) * 60)),
            message: 'روانگی آمد کے کم از کم 30 منٹ بعد درج ہو سکتی ہے۔'
          });
          const allocated = await Attendance.find({ ...scope, 'shifts.sessionStart': originalStart }).session(session);
          for (const record of allocated) {
            const first = record.shifts.find(shift => +shift.sessionStart === +originalStart && +shift.checkIn === +originalStart);
            record.shifts = record.shifts.filter(shift => +shift.sessionStart !== +originalStart);
            if (first) record.shifts.push({ checkIn: originalStart, checkOut: null, duration: 0,
              missed: false, sessionStart: originalStart, checkInSource: first.checkInSource });
            if (!record.shifts.length) {
              await record.deleteOne({ session });
              continue;
            }
            const last = record.shifts[record.shifts.length - 1];
            record.checkIn = last.checkIn;
            record.checkOut = last.checkOut;
            record.checkInSource = last.checkInSource;
            record.checkOutSource = last.checkOutSource;
            record.duration = record.shifts.reduce((total, shift) => total + (shift.missed ? 0 : shift.duration || 0), 0);
            await record.save({ session });
          }
        }
      }
      const stampScan = record => {
        if (clientId) record.clientIds = [...(record.clientIds || []), clientId];
      };
      const minutesBetween = (start, end) => Math.max(0, Math.floor((end - start) / 60000));
      const finishSession = (record, start, end, checkOutSource = 'fingerprint', sessionStart = start) => {
        const minutes = minutesBetween(start, end);
        if (!record.shifts) record.shifts = [];
        const last = record.shifts[record.shifts.length - 1];
        if (last && !last.checkOut && !last.missed) {
          last.checkIn = start;
          last.checkOut = end;
          last.duration = minutes;
          last.missed = false;
        } else {
          record.shifts.push({ checkIn: start, checkOut: end, duration: minutes, missed: false });
        }
        const finished = record.shifts[record.shifts.length - 1];
        finished.checkInSource = +start === +sessionStart ? record.checkInSource : 'boundary';
        finished.checkOutSource = checkOutSource;
        finished.sessionStart = sessionStart;
        record.checkOut = end;
        record.checkOutSource = checkOutSource;
        record.duration = (record.duration || 0) + minutes;
        record.status = 'Present';
        // markedByFace is deliberately preserved.
      };

      // Use scan time and bypass cron's sync grace for the 20-hour cutoff.
      await runAutoCheckOut(scope, now, session);
      const open = await Attendance.findOne({ ...scope, checkIn: { $ne: null }, checkOut: null,
        $expr: { $ne: [{ $arrayElemAt: ['$shifts.missed', -1] }, true] }
      }).sort({ checkIn: -1 }).session(session);

      if (open) {
        const start = new Date(open.checkIn);
        const elapsedMinutes = (now - start) / 60000;
        if (elapsedMinutes < 1) {
          return result({
            action: 'too_soon', status: 'checked_in', employeeName: user.name,
            retryAfterSeconds: Math.max(1, Math.ceil((1 - elapsedMinutes) * 60)),
            message: 'روانگی آمد کے کم از کم 1 منٹ بعد درج ہو سکتی ہے۔'
          });
        }
        const startWorkDay = getWorkDay(start);
        if (startWorkDay === today) {
          finishSession(open, start, now);
          stampScan(open);
          await open.save({ session });
        } else {
          const boundary = new Date(today + 'T06:00:00.000+05:00');
          let nextDay = await Attendance.findOne({ ...scope, date: today }).session(session);
          if (!nextDay) nextDay = new Attendance({ ...scope, date: today, status: 'Present', shifts: [] });
          finishSession(open, start, boundary, 'boundary');
          nextDay.checkIn = boundary;
          nextDay.checkInSource = 'boundary';
          finishSession(nextDay, boundary, now, 'fingerprint', start);
          stampScan(nextDay);
          await open.validate();
          await nextDay.validate();
          await open.save({ session });
          await nextDay.save({ session });
        }
        return result({
          action: 'checkout', status: 'checked_out', employeeName: user.name,
          workedMinutes: minutesBetween(start, now), serverTime: now.toISOString(),
          message: 'آپ کی روانگی درج ہو گئی ہے۔'
        });
      }

      let attendance = await Attendance.findOne({ ...scope, date: today }).session(session);
      // The previous real or automatic OUT may belong to yesterday's workday.
      const previous = await Attendance.findOne({ ...scope, checkOut: { $ne: null },
        checkOutSource: { $ne: 'boundary' }
      }).sort({ checkOut: -1 }).session(session);
      if (previous?.checkOut && now - new Date(previous.checkOut) < 600000) {
        return result({
          action: 'too_soon', status: 'checked_out', employeeName: user.name,
          retryAfterSeconds: Math.max(1, Math.ceil((600000 - (now - new Date(previous.checkOut))) / 1000)),
          message: 'Already checked out. Please wait 10 minutes before starting your next shift.'
        });
      }
      if (!attendance) attendance = new Attendance({ ...scope, date: today, duration: 0, shifts: [] });
      attendance.checkIn = now;
      attendance.checkInSource = 'fingerprint';
      attendance.checkOut = null;
      attendance.checkOutSource = undefined;
      attendance.status = 'Present';
      if (!attendance.shifts) attendance.shifts = [];
      attendance.shifts.push({ checkIn: now, checkOut: null, duration: 0, missed: false,
        checkInSource: 'fingerprint', sessionStart: now });
      stampScan(attendance);
      await attendance.save({ session });
      return result({
        action: 'checkin', status: 'checked_in', employeeName: user.name,
        serverTime: now.toISOString(), message: 'آپ کی آمد درج ہو گئی ہے۔'
      }, 201);
    });
    return res.status(reply.code).json(reply.body);
  } catch (error) {
    console.error('[Fingerprint attendance]', error);
    if (error.code === 11000) {
      return res.status(409).json({ message: 'حاضری کی تصدیق کے لیے انتظامیہ سے رابطہ کریں۔' });
    }
    return res.status(500).json({ message: 'حاضری کی تصدیق نہیں ہو سکی۔ انتظامیہ سے رابطہ کریں۔' });
  } finally {
    if (lockKey) inFlight.delete(lockKey);
  }
});

module.exports = router;