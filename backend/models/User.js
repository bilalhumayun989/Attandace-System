const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        employeeId: {
            type: String,
            required: true,
            unique: true,
        },
        name: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            required: false,
        },

        password: {
            type: String,
            required: true,
        },
        role: {
            type: String,
            required: true,
            default: 'Employee',
        },
        department: {
            type: String,
            required: true,
        },
        workingHours: {
            start: { type: String, required: true, default: '09:00' },
            end: { type: String, required: true, default: '18:00' },
        },
        status: {
            type: String,
            required: true,
            default: 'Active',
        },
        joinDate: {
            type: String,
            required: true,
            default: () => new Date().toISOString().split('T')[0],
        },
        salary: {
            type: Number,
            default: 0,
        },
        phone: {
            type: String,
            default: '',
        },
        address: {
            type: String,
            default: '',
        },
        bio: {
            type: String,
            default: '',
        },
        leaveQuota: {
            type: Number,
            default: 0,
        },
        offDays: {
            type: [Number],
            default: [0], // Default Sunday off (0 = Sunday, 6 = Saturday)
        },
        extraHourlyRate: {
            type: Number,
            default: 0,
        },
        isOvertimeAllowed: {
            type: Boolean,
            default: false,
        },
        shortTimeHourlyRate: {
            type: Number,
            default: 0, // 0 means use standard per-minute calculation
        },
        title: {
            type: String,
            default: '',
        },
        adminId: {

            type: require('mongoose').Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        faceDescriptors: {
            type: [[Number]],
            default: [],
        },
        faceEnrolled: {
            type: Boolean,
            default: false,
        },
        isVerified: {
            type: Boolean,
            default: false,
        },
        verificationToken: {
            type: String,
            default: null,
        },
        resetPasswordToken: {
            type: String,
            default: null,
        },
        resetPasswordExpire: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);



const User = mongoose.model('User', userSchema);

module.exports = User;
