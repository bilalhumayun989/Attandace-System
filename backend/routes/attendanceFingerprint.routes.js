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
router.post('/fingerprint-checkin', async (req, res) => {
  try {
    const { userId, timestamp } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'userId zaroori hai' });
    }

    const employee = await Employee.findById(userId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee nahi mila' });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayRecord = await Attendance.findOne({
      employee: userId,
      date: { $gte: startOfDay }
    }).sort({ createdAt: -1 });

    const action = (!todayRecord || todayRecord.status === 'checked_out') ? 'checkin' : 'checkout';

    const record = await Attendance.create({
      employee: userId,
      action,
      status: action === 'checkin' ? 'checked_in' : 'checked_out',
      date: timestamp ? new Date(timestamp) : new Date()
    });

    res.status(201).json({
      message: action === 'checkin'
        ? `${employee.name} check-in ho gaya`
        : `${employee.name} check-out ho gaya`,
      status: record.status,
      employeeName: employee.name
    });
  } catch (err) {
    res.status(500).json({ message: 'Attendance mark nahi ho saki', error: err.message });
  }
});

module.exports = router;
