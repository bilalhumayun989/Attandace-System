const User = require('../models/User');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');

dotenv.config();

// Email transporter configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Helper to generate JWT
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'secret123', {
        expiresIn: '30d',
    });
};

// @desc    Create a new employee and send email
// @route   POST /api/users/add
// @access  Public (Should be protected by Admin middleware in production)
const createEmployee = async (req, res) => {
    const { name, email, password, role, department, salary, offDays } = req.body;
    console.log('[createEmployee] Received offDays:', offDays);
    try {
        // 1. Generate Employee ID
        let nextNumber = 1;
        const lastEmpUser = await User.findOne({ employeeId: /^EMP-\d+$/ }).sort({ createdAt: -1 });
        if (lastEmpUser && lastEmpUser.employeeId) {
            const numPart = lastEmpUser.employeeId.split('-')[1];
            if (numPart && !isNaN(numPart)) {
                nextNumber = parseInt(numPart) + 1;
            }
        }
        const employeeId = `EMP-${nextNumber.toString().padStart(3, '0')}`;

        const userExists = await User.findOne({ employeeId });
        if (userExists) {
            // Unlikely to happen, but handled just in case
            return res.status(400).json({ message: 'Employee ID already exists. Please try again.' });
        }
        // 2. Generate a random password if not provided
        const generatedPassword = password || Math.random().toString(36).slice(-8);
        // 3. Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(generatedPassword, salt);
        // 4. Create User in DB (email is optional)
        const user = await User.create({
            employeeId,
            name,
            email,
            password: hashedPassword,
            role,
            department,
            isVerified: true,
            salary: salary || 0,
            offDays: offDays && Array.isArray(offDays) ? offDays : [5],
            adminId: req.adminId,
        });
        if (user) {
            // Only attempt to send email if a valid-looking email is provided
            if (email && typeof email === 'string' && email.trim().includes('@')) {
                const mailOptions = {
                    from: `"Brosh-Tech HRM" <${process.env.EMAIL_USER}>`,
                    to: email.trim(),
                    subject: 'Your Account Credentials',
                    text: `Your account has been created. Employee ID: ${employeeId}, Password: ${generatedPassword}`
                };
                await transporter.sendMail(mailOptions).catch(err => console.error('Email send error:', err));
            }
            res.status(201).json({
                _id: user._id,
                employeeId: user.employeeId,
                name: user.name,
                email: user.email,
                message: 'Employee created successfully',
            });
        } else {
            res.status(400).json({ message: 'Invalid user data' });
        }
    } catch (error) {
        console.error('Error in createEmployee:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Get all employees/staff (non-admin)
// @route   GET /api/users
// @access  Private/Admin
const getEmployees = async (req, res) => {
    try {
        // Show all users who are NOT Admins or SuperAdmins AND belong to the current admin's tenant
        const users = await User.find({ role: { $nin: ['Admin', 'SuperAdmin'] }, adminId: req.adminId }).sort({ createdAt: -1 });
        res.json(users);
    } catch (error) {
        console.error('Error in getEmployees:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Auth user & get token
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
    const { id, password } = req.body; // 'id' can be email or employeeId
    try {
        // Find user by employeeId OR email
        let user = await User.findOne({
            $or: [
                { employeeId: id },
                { email: { $regex: new RegExp(`^${id}$`, 'i') } }
            ]
        });
        // Ensure only admins and superadmins can login
        if (user && user.role !== 'Admin' && user.role !== 'SuperAdmin') {
            return res.status(401).json({ message: 'Only admin or superadmin users can login.' });
        }
        if (user && (await bcrypt.compare(password, user.password))) {
            // Check if user is verified
            if (!user.isVerified) {
                return res.status(401).json({ message: 'Please verify your email before logging in.' });
            }

            const token = generateToken(user._id);
            const isAdminOrSuper = user.role === 'Admin' || user.role === 'SuperAdmin';
            const cookieName = isAdminOrSuper ? 'jwt_admin' : 'jwt_employee';
            const otherCookie = isAdminOrSuper ? 'jwt_employee' : 'jwt_admin';

            // Clear the "other" cookie to avoid RBAC leaks
            res.clearCookie(otherCookie);

            res.cookie(cookieName, token, {
                httpOnly: true,
                secure: false, // Set to false for HTTP deployments
                sameSite: 'lax', // Use 'lax' for same-site or cross-port HTTP
                path: '/',
                maxAge: 29 * 24 * 60 * 60 * 1000 // 29 days
            });

            res.json({
                _id: user._id,
                employeeId: user.employeeId,
                name: user.name,
                email: user.email,
                role: user.role,
                department: user.department,
                salary: user.salary,
                offDays: user.offDays,
                token: token
            });
        } else {
            res.status(401).json({ message: 'Invalid ID/Email or password' });

        }

    } catch (error) {
        console.error('Error in loginUser:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Register a new admin
// @route   POST /api/users/register
// @access  Public
const registerAdmin = async (req, res) => {
    const { employeeId, name, email, password, companyName } = req.body;
    try {
        const userExists = await User.findOne({ employeeId });
        if (userExists) {
            return res.status(400).json({ message: 'Employee ID already exists' });
        }


        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const verificationToken = crypto.randomBytes(32).toString('hex');
        const newUserId = new mongoose.Types.ObjectId();

        const user = await User.create({
            _id: newUserId,
            employeeId,
            name,
            email,
            password: hashedPassword,
            role: 'Admin',
            department: companyName || 'Management',
            offDays: [5],
            adminId: newUserId, // Admin is their own tenant
            isVerified: false,
            verificationToken
        });


        if (user) {
            // Send verification email only if valid email is provided
            if (email && typeof email === 'string' && email.trim().includes('@')) {
                const baseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'http://localhost:5173';
                const verificationUrl = `${baseUrl}/attendance/verify-email/${verificationToken}`;
                
                const mailOptions = {
                    from: `"Brosh-Tech HRM" <${process.env.EMAIL_USER}>`,
                    to: email.trim(),
                    subject: 'Verify Your Email - Brosh-Tech HRM',
                    html: `
                        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                            <h2 style="color: #4f46e5;">Welcome to Brosh-Tech HRM</h2>
                            <p>Hi <strong>${name}</strong>,</p>
                            <p>Thank you for registering. Please verify your email address to activate your account.</p>
                            <div style="margin: 30px 0;">
                                <a href="${verificationUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email Address</a>
                            </div>
                            <p>If the button doesn't work, copy and paste this link into your browser:</p>
                            <p>${verificationUrl}</p>
                            <p>Best regards,<br>Team Brosh-Tech HRM</p>
                        </div>
                    `,
                };

                await transporter.sendMail(mailOptions);
                console.log(`Verification email sent to: ${email}`);
            }

            res.status(201).json({
                message: 'Registration successful! Please check your email to verify your account.'
            });
        } else {
            res.status(400).json({ message: 'Invalid user data' });
        }
    } catch (error) {
        console.error('Error in registerAdmin:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Verify email
// @route   GET /api/users/verify-email/:token
// @access  Public
const verifyEmail = async (req, res) => {
    try {
        const { token } = req.params;
        const user = await User.findOne({ verificationToken: token });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired verification token' });
        }

        user.isVerified = true;
        user.verificationToken = null;
        await user.save();

        res.json({ message: 'Email verified successfully! You can now login.' });
    } catch (error) {
        console.error('Error in verifyEmail:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Resend verification email
// @route   POST /api/users/resend-verification
// @access  Public
const resendVerification = async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await User.findOne({ 
            email: { $regex: new RegExp(`^${email}$`, 'i') }, 
            isVerified: false 
        });

        if (!user) {
            return res.status(404).json({ message: 'No unverified user found with this email.' });
        }

        // Generate new token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        user.verificationToken = verificationToken;
        await user.save();

        const baseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'http://localhost:5173';
        const verificationUrl = `${baseUrl}/attendance/verify-email/${verificationToken}`;

        const mailOptions = {
            from: `"Brosh-Tech HRM" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Verify Your Email (Resend) - Brosh-Tech HRM',
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <h2 style="color: #4f46e5;">Email Verification</h2>
                    <p>Hi <strong>${user.name}</strong>,</p>
                    <p>You requested to resend the verification email. Please click the button below to activate your account.</p>
                    <div style="margin: 30px 0;">
                        <a href="${verificationUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email Address</a>
                    </div>
                    <p>If the button doesn't work, copy and paste this link into your browser:</p>
                    <p>${verificationUrl}</p>
                    <p>Best regards,<br>Team Brosh-Tech HRM</p>
                </div>
            `,
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: 'Verification email resent successfully. Please check your inbox.' });
    } catch (error) {
        console.error('Error in resendVerification:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Forgot password
// @route   POST /api/users/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        // Find user (prioritize verified ones if multiple exist with same email)
        let user = await User.findOne({ 
            email: { $regex: new RegExp(`^${email}$`, 'i') }, 
            isVerified: true 
        });
        if (!user) {
            user = await User.findOne({ 
                email: { $regex: new RegExp(`^${email}$`, 'i') } 
            });
        }

        if (!user) {
            return res.status(404).json({ message: 'No user found with this email.' });
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpire = Date.now() + 3600000; // 1 hour
        await user.save();

        const baseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'http://localhost:5173';
        const resetUrl = `${baseUrl}/reset-password/${resetToken}`;

        const mailOptions = {
            from: `"Brosh-Tech HRM" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Password Reset Request - Brosh-Tech HRM',
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <h2 style="color: #4f46e5;">Password Reset Request</h2>
                    <p>Hi <strong>${user.name}</strong>,</p>
                    <p>You requested a password reset. Please click the button below to set a new password. This link is valid for 1 hour.</p>
                    <div style="margin: 30px 0;">
                        <a href="${resetUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
                    </div>
                    <p>If you did not request this, please ignore this email.</p>
                    <p>Best regards,<br>Team Brosh-Tech HRM</p>
                </div>
            `,
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: 'Password reset email sent successfully. Please check your inbox.' });
    } catch (error) {
        console.error('Error in forgotPassword:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Reset password
// @route   PUT /api/users/reset-password/:token
// @access  Public
const resetPassword = async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpire: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired reset token.' });
        }

        // Set new password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        user.resetPasswordToken = null;
        user.resetPasswordExpire = null;

        // Auto-verify if they were somehow unverified but had a reset link
        user.isVerified = true;
        
        await user.save();

        res.json({ message: 'Password reset successful! You can now login with your new password.' });
    } catch (error) {
        console.error('Error in resetPassword:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Get current user profile
// @route   GET /api/users/me
// @access  Private
const getMe = async (req, res) => {
    try {
        // req.user is already populated by 'protect' middleware
        if (req.user) {
            res.json({
                _id: req.user._id,
                name: req.user.name,
                email: req.user.email,
                role: req.user.role,
                department: req.user.department,
                salary: req.user.salary,
                offDays: req.user.offDays,
                customRole: req.user.customRole,
                permissions: req.user.permissions
            });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error('Error in getMe:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Logout user
// @route   POST /api/users/logout
// @access  Public
const logoutUser = (req, res) => {
    const { role } = req.query; // 'Admin' or 'Employee'

    if (role === 'Admin' || role === 'SuperAdmin') {
        res.cookie('jwt_admin', '', { httpOnly: true, expires: new Date(0) });
    } else if (role === 'Employee') {
        res.cookie('jwt_employee', '', { httpOnly: true, expires: new Date(0) });
    } else {
        // If no role specified, clear both (legacy/fallback)
        res.cookie('jwt_admin', '', { httpOnly: true, expires: new Date(0) });
        res.cookie('jwt_employee', '', { httpOnly: true, expires: new Date(0) });
    }

    res.status(200).json({ message: `Logged out ${role || 'user'} successfully` });
};

// @desc    Update employee
// @route   PUT /api/users/:id
// @access  Private/Admin
const updateUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (user) {
            // Authorization Check
            const hasEditPermission = req.user && (req.user.role === 'Admin' || req.user.role === 'SuperAdmin' || (req.user.permissions && req.user.permissions.employees && req.user.permissions.employees.edit));
            const isSelf = req.user && req.user._id.toString() === user._id.toString();

            if (!hasEditPermission && !isSelf) {
                return res.status(403).json({ message: 'Not authorized to update this user' });
            }

            // Prevent non-owner-admins from updating owner-admin users (Base security)
            const isTargetOwnerAdmin = (user.role === 'Admin' || user.role === 'SuperAdmin') && (!user.customRole);
            const isRequesterOwnerAdmin = (req.user.role === 'Admin' || req.user.role === 'SuperAdmin') && (!req.user.customRole);

            if (isTargetOwnerAdmin && !isRequesterOwnerAdmin) {
                return res.status(403).json({ message: 'Only owner admins can edit other owner admins' });
            }

            // Fields that only Admins or users with edit permission can update
            if (hasEditPermission && !isSelf) {
                user.name = req.body.name || user.name;
                user.email = req.body.email || user.email;
                user.role = req.body.role || user.role;
                user.department = req.body.department || user.department;
                user.salary = req.body.salary !== undefined ? req.body.salary : user.salary;
                user.offDays = req.body.offDays && Array.isArray(req.body.offDays) ? req.body.offDays : user.offDays;
                console.log('[updateUser] Saving offDays:', user.offDays, '| received:', req.body.offDays);
                user.customRole = req.body.customRole !== undefined ? req.body.customRole : user.customRole;
                
                if (req.body.status) {
                    if (user.status === 'Deleted' && req.body.status === 'Active') {
                        user.faceEnrolled = false;
                        user.faceDescriptors = [];
                    }
                    user.status = req.body.status;
                }
            } else if (isSelf) {
                // Allow self-update for name and email, but prevent sensitive fields
                user.name = req.body.name || user.name;
                user.email = req.body.email || user.email;
                user.offDays = req.body.offDays && Array.isArray(req.body.offDays) ? req.body.offDays : user.offDays;
                // Explicitly prevent changes to role, salary for self-update (unless owner admin, but usually handled here)
            }

            // Profile fields (Available to Admin/Editor and Self)
            user.phone = req.body.phone !== undefined ? req.body.phone : user.phone;
            user.address = req.body.address !== undefined ? req.body.address : user.address;
            user.bio = req.body.bio !== undefined ? req.body.bio : user.bio;
            user.title = req.body.title !== undefined ? req.body.title : user.title;

            if (req.body.newPassword) {
                // If it's a self-update, require current password
                if (isSelf) {
                    if (!req.body.currentPassword) {
                        return res.status(400).json({ message: 'Current password is required' });
                    }
                    const isMatch = await bcrypt.compare(req.body.currentPassword, user.password);
                    if (!isMatch) {
                        return res.status(400).json({ message: 'Invalid current password' });
                    }
                } else if (!hasEditPermission) {
                    return res.status(403).json({ message: 'Not authorized to change password' });
                }

                const passwordToHash = req.body.newPassword;
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(passwordToHash, salt);
            } else if (req.body.password) {
                // Legacy/Admin direct reset
                if (hasEditPermission) {
                    const salt = await bcrypt.genSalt(10);
                    user.password = await bcrypt.hash(req.body.password, salt);
                }
            }

            const updatedUser = await user.save();

            res.json({
                _id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                role: updatedUser.role,
                department: updatedUser.department,
                salary: updatedUser.salary,
                offDays: updatedUser.offDays,
                status: updatedUser.status
            });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error('Error in updateUser:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Delete employee (Soft Delete)
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (user) {
            // Prevent deleting Admins/SuperAdmins through this endpoint
            if (user.role === 'Admin' || user.role === 'SuperAdmin') {
                return res.status(403).json({ message: 'Admins and SuperAdmins cannot be deleted through this endpoint' });
            }

            user.status = 'Deleted';
            await user.save();
            res.json({ message: 'User marked as deleted' });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error('Error in deleteUser:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

module.exports = {
    createEmployee,
    getEmployees,
    loginUser,
    registerAdmin,
    updateUser,
    deleteUser,
    getMe,
    logoutUser,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword
};
