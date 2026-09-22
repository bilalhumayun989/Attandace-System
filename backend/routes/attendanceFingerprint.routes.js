// attendanceFingerprint.routes.js
//
// Apne existing Express app mein add karein, jaise:
//   app.use('/api/attendance', require('./attendanceFingerprint.routes'));
//
// NOTE: Employee model mein ek naya field add karna hoga:
//   fingerprintTemplate: { type: String, default: null }   // base64 string
//
// Model names (Employee, Attendance) apne asal project ke naam se badal lein.

const express = require('express');
const router = express.Router();
const Employee = require('../models/User');       // actual path to User model
const Attendance = require('../models/Attendance');    // actual path to Attendance model

// ── GET: Kiosk startup pe sab employees ke fingerprint templates dene ke liye ──
router.get('/fingerprint-templates', async (req, res) => {
  try {
    const employees = await Employee.find(
      { fingerprintTemplate: { $exists: true, $ne: null } },
      { name: 1, fingerprintTemplate: 1 }
    );
    res.json({ employees });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load templates', error: err.message });
  }
});

// ── POST: Admin tool se naye employee ka fingerprint template save karna ──
router.post('/fingerprint-enroll', async (req, res) => {
  try {
    const { userId, template } = req.body;
    if (!userId || !template) {
      return res.status(400).json({ message: 'userId aur template dono zaroori hain' });
    }
    await Employee.findByIdAndUpdate(userId, { fingerprintTemplate: template });
    res.json({ message: 'Fingerprint enroll ho gaya' });
  } catch (err) {
    res.status(500).json({ message: 'Enrollment fail hua', error: err.message });
  }
});

// ── POST: Kiosk se scan ke baad attendance mark karna ──
// Check-in/check-out khud decide hota hai (aaj ka pehla scan = check-in, agla = check-out)
// router.post('/fingerprint-checkin', async (req, res) => {
//   try {
//     const { userId, timestamp } = req.body;
//     if (!userId) {
//       return res.status(400).json({ message: 'userId zaroori hai' });
//     }

//     const employee = await Employee.findById(userId);
//     if (!employee) {
//       return res.status(404).json({ message: 'Employee nahi mila' });
//     }

//     const startOfDay = new Date();
//     startOfDay.setHours(0, 0, 0, 0);

//     const todayRecord = await Attendance.findOne({
//       employee: userId,
//       date: { $gte: startOfDay }
//     }).sort({ createdAt: -1 });

//     const action = (!todayRecord || todayRecord.status === 'checked_out') ? 'checkin' : 'checkout';

//     const record = await Attendance.create({
//       employee: userId,
//       action,
//       status: action === 'checkin' ? 'checked_in' : 'checked_out',
//       date: timestamp ? new Date(timestamp) : new Date()
//     });

//     res.status(201).json({
//       message: action === 'checkin'
//         ? `${employee.name} check-in ho gaya`
//         : `${employee.name} check-out ho gaya`,
//       status: record.status,
//       employeeName: employee.name
//     });
//   } catch (err) {
//     res.status(500).json({ message: 'Attendance mark nahi ho saki', error: err.message });
//   }
// });


// Fingerprint attendance — uses the existing Attendance schema.
// Date/time comes from the server, not the kiosk timestamp.
router.post('/fingerprint-checkin', async (req, res) => {
  try {
    const { userId } = req.body;

    if (typeof userId !== 'string' || !/^[a-f\d]{24}$/i.test(userId)) {
      return res.status(400).json({ message: 'Valid userId zaroori hai' });
    }

    const user = await Employee.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'Employee nahi mila' });
    }

    if (user.status === 'Deleted') {
      return res.status(400).json({
        message: 'Deleted employee attendance mark nahi kar sakta'
      });
    }

    if (!user.adminId) {
      return res.status(400).json({
        message: 'Employee ke User record mein adminId missing hai'
      });
    }

    const { formatInTimeZone } = require('date-fns-tz');
    const now = new Date();
    const pktDate = date =>
      formatInTimeZone(date, 'Asia/Karachi', 'yyyy-MM-dd');

    const today = pktDate(now);
    const minutesBetween = (start, end) =>
      Math.max(0, Math.floor((end - start) / 60000));

    // Complete an existing shift placeholder, or add a completed session.
    const finishSession = (record, start, end) => {
      const minutes = minutesBetween(start, end);

      if (!record.shifts) record.shifts = [];

      const last = record.shifts[record.shifts.length - 1];

      if (last && !last.checkOut && !last.missed) {
        last.checkIn = start;
        last.checkOut = end;
        last.duration = minutes;
        last.missed = false;
      } else {
        record.shifts.push({
          checkIn: start,
          checkOut: end,
          duration: minutes,
          missed: false
        });
      }

      record.checkOut = end;
      record.duration = (record.duration || 0) + minutes;
      record.status = 'Present';

      // Existing markedByFace value is deliberately preserved.
    };

    let open = await Attendance.findOne({
      userId,
      checkIn: { $ne: null },
      checkOut: null
    }).sort({ checkIn: -1 });

    // Close an expired shift so it cannot remain open indefinitely.
    if (open && now - new Date(open.checkIn) > 20 * 60 * 60 * 1000) {
      if (!open.shifts) open.shifts = [];

      const last = open.shifts[open.shifts.length - 1];

      if (last && !last.checkOut) {
        last.missed = true;
      } else {
        open.shifts.push({
          checkIn: open.checkIn,
          duration: 0,
          missed: true
        });
      }

      open.status = open.shifts.some(s => s.checkOut && !s.missed)
        ? 'Present'
        : 'Absent';

      open.checkOut = open.checkIn;
      await open.save();
      open = null;
    }

    // An open shift means this scan is a checkout.
    if (open) {
      const start = new Date(open.checkIn);
      const elapsedMinutes = (now - start) / 60000;

      // Same checkout rule as your face controller.
      if (elapsedMinutes < 30) {
        return res.json({
          action: 'too_soon',
          status: 'checked_in',
          employeeName: user.name,
          message:
            `Please wait ${Math.ceil(30 - elapsedMinutes)} ` +
            'more minutes before checking out.'
        });
      }

      if (pktDate(start) === today) {
        finishSession(open, start, now);
        await open.save();
      } else {
        // Split an overnight shift at midnight PKT.
        const midnight = new Date(`${today}T00:00:00.000+05:00`);

        let nextDay = await Attendance.findOne({
          userId,
          date: today
        });

        if (!nextDay) {
          nextDay = new Attendance({
            userId,
            adminId: user.adminId,
            date: today,
            status: 'Present',
            shifts: []
          });
        }

        finishSession(open, start, midnight);

        nextDay.checkIn = midnight;
        finishSession(nextDay, midnight, now);

        // Validate both records before either write.
        await open.validate();
        await nextDay.validate();

        await open.save();
        await nextDay.save();
      }

      return res.json({
        action: 'checkout',
        status: 'checked_out',
        employeeName: user.name,
        message: `${user.name} — Checked Out`
      });
    }

    // No open shift: create or reopen today's single attendance record.
    let attendance = await Attendance.findOne({
      userId,
      date: today
    });

    // Avoid an immediate accidental check-in after checkout.
    if (
      attendance?.checkOut &&
      now - new Date(attendance.checkOut) < 30000
    ) {
      return res.json({
        action: 'too_soon',
        status: 'checked_out',
        employeeName: user.name,
        message: 'Already checked out. Please wait 30 seconds.'
      });
    }

    if (!attendance) {
      attendance = new Attendance({
        userId,
        adminId: user.adminId,
        date: today,
        duration: 0,
        shifts: []
      });
    }

    attendance.checkIn = now;
    attendance.checkOut = null;
    attendance.status = 'Present';

    if (!attendance.shifts) attendance.shifts = [];

    attendance.shifts.push({
      checkIn: now,
      checkOut: null,
      duration: 0,
      missed: false
    });

    await attendance.save();

    return res.status(201).json({
      action: 'checkin',
      status: 'checked_in',
      employeeName: user.name,
      message: `${user.name} — Checked In`
    });
  } catch (error) {
    console.error('[Fingerprint attendance]', error);

    if (error.code === 11000) {
      return res.status(409).json({
        message: 'Attendance changed during this scan. Please check current status.'
      });
    }

    return res.status(500).json({
      message: 'Attendance mark nahi ho saki. Server logs check karein.'
    });
  }
});


module.exports = router;
