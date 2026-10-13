const User = require('../models/User');

const staffScope = (req) => ({
    adminId: req.adminId,
    role: { $nin: ['Admin', 'SuperAdmin'] },
    status: { $ne: 'Deleted' }
});

// Return enrollment status without exposing biometric templates.
const getBiometricUsers = async (req, res) => {
    try {
        const users = await User.find(staffScope(req))
            .select('_id name employeeId faceEnrolled faceDescriptors fingerprintTemplate')
            .sort({ name: 1 }).lean();
        res.json(users.map(user => ({
            _id: user._id,
            name: user.name,
            employeeId: user.employeeId,
            faceEnrolled: Boolean(user.faceEnrolled || user.faceDescriptors?.length),
            fingerprintEnrolled: Boolean(user.fingerprintTemplate)
        })));
    } catch (error) {
        console.error('Error loading biometric users:', error);
        res.status(500).json({ message: 'Unable to load biometric users' });
    }
};

const removeBiometrics = async (req, res) => {
    const { type, userIds } = req.body || {};
    if (!['face', 'fingerprint'].includes(type)) {
        return res.status(400).json({ message: 'Choose face or fingerprint data' });
    }
    if (!Array.isArray(userIds) || !userIds.length ||
        userIds.some(id => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))) {
        return res.status(400).json({ message: 'Select valid users to delete biometric data' });
    }
    try {
        const ids = [...new Set(userIds)];
        const query = { ...staffScope(req), _id: { $in: ids } };
        const count = await User.countDocuments(query);
        if (count !== ids.length) {
            return res.status(404).json({ message: 'One or more selected users are unavailable' });
        }
        const fields = type === 'face'
            ? { faceDescriptors: [], faceEnrolled: false }
            : { fingerprintTemplate: null };
        const result = await User.updateMany(query, { $set: fields });
        res.json({
            success: true,
            modifiedCount: result.modifiedCount,
            message: `${type === 'face' ? 'Face' : 'Fingerprint'} data deleted for ${result.modifiedCount} user(s)`
        });
    } catch (error) {
        console.error('Error removing biometric data:', error);
        res.status(500).json({ message: 'Unable to delete biometric data' });
    }
};

module.exports = { getBiometricUsers, removeBiometrics };
