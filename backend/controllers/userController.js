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
    const { employeeId, name, email, password, role, department, workingHours, salary, extraHourlyRate, isOvertimeAllowed } = req.body;


    try {
        // 1. Check if user already exists
        const userExists = await User.findOne({ employeeId });
        if (userExists) {
            return res.status(400).json({ message: 'Employee ID already exists' });
        }


        // 2. Send Email
        const mailOptions = {
            from: `"Brosh-Tech HRM" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Welcome to Brosh-Tech HRM - Your Account Credentials',
            text: `Hi ${name},\n\nYour account has been created successfully.\n\nInform them your password and Employee ID for login into Brosh-Tech HRM is:\nEmployee ID: ${employeeId}\nPassword: ${password}\nYour Working Hours: ${workingHours.start} to ${workingHours.end}\nMonthly Salary: ${salary}\n\nPlease change your password after your first login.\n\nBest regards,\nAdmin Team`,

            html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #4f46e5;">Welcome to Brosh-Tech HRM</h2>
          <p>Hi <strong>${name}</strong>,</p>
          <p>Your account has been created successfully by the admin.</p>
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Login Credentials:</strong></p>
            <p style="margin: 5px 0;"><strong>Employee ID:</strong> ${employeeId}</p>
            <p style="margin: 5px 0;"><strong>Password:</strong> ${password}</p>

            <p style="margin: 5px 0;"><strong>Working Hours:</strong> ${workingHours.start} to ${workingHours.end}</p>
            <p style="margin: 5px 0;"><strong>Monthly Salary:</strong> ${salary}</p>
          </div>
          <p>You can now login into <a href="http://localhost:5173" style="color: #4f46e5; text-decoration: none; font-weight: bold;">Brosh-Tech HRM</a>.</p>
          <p><em>Please make sure to change your password after your first login.</em></p>
          <p>Best regards,<br>Admin Team</p>
        </div>
      `,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Welcome email sent to: ${email}`);

        // 3. Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Create User in DB
        const user = await User.create({
            employeeId,
            name,
            email,
            password: hashedPassword,
            role,
            department,
            workingHours,
            isVerified: true, // Employees created by admin are auto-verified
            salary: salary || 0,
            extraHourlyRate: extraHourlyRate || 0,
            isOvertimeAllowed: isOvertimeAllowed || false,
            adminId: req.adminId, // Scope to the tenant
        });


        if (user) {
            res.status(201).json({
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                department: user.department,
                workingHours: user.workingHours,
                salary: user.salary,
                extraHourlyRate: user.extraHourlyRate,
                isOvertimeAllowed: user.isOvertimeAllowed,
                message: 'Employee created and email sent successfully',
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
        // Show all users who are NOT Admins AND belong to the current admin's tenant
        const users = await User.find({ role: { $ne: 'Admin' }, adminId: req.adminId }).sort({ createdAt: -1 });
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
        // Try finding by employeeId OR email
        let user = await User.findOne({
            $or: [
                { employeeId: id },
                { email: { $regex: new RegExp(`^${id}$`, 'i') } }
            ]
        });



        if (user && (await bcrypt.compare(password, user.password))) {
            // Check if user is verified
            if (!user.isVerified) {
                return res.status(401).json({ message: 'Please verify your email before logging in.' });
            }

            const token = generateToken(user._id);
            const cookieName = user.role === 'Admin' ? 'jwt_admin' : 'jwt_employee';
            const otherCookie = user.role === 'Admin' ? 'jwt_employee' : 'jwt_admin';

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
                workingHours: user.workingHours,
                salary: user.salary
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
            workingHours: { start: '09:00', end: '18:00' },
            adminId: newUserId, // Admin is their own tenant
            isVerified: false,
            verificationToken
        });


        if (user) {
            // Send verification email
            const baseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'http://localhost:5173';
            const verificationUrl = `${baseUrl}/verify-email/${verificationToken}`;
            
            const mailOptions = {
                from: `"Brosh-Tech HRM" <${process.env.EMAIL_USER}>`,
                to: email,
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
        const verificationUrl = `${baseUrl}/verify-email/${verificationToken}`;

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
                workingHours: req.user.workingHours,
                salary: req.user.salary,
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

    if (role === 'Admin') {
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
            const hasEditPermission = req.user && (req.user.role === 'Admin' || (req.user.permissions && req.user.permissions.employees && req.user.permissions.employees.edit));
            const isSelf = req.user && req.user._id.toString() === user._id.toString();

            if (!hasEditPermission && !isSelf) {
                return res.status(403).json({ message: 'Not authorized to update this user' });
            }

            // Prevent non-owner-admins from updating owner-admin users (Base security)
            const isTargetOwnerAdmin = user.role === 'Admin' && (!user.customRole);
            const isRequesterOwnerAdmin = req.user.role === 'Admin' && (!req.user.customRole);

            if (isTargetOwnerAdmin && !isRequesterOwnerAdmin) {
                return res.status(403).json({ message: 'Only owner admins can edit other owner admins' });
            }

            // Fields that only Admins or users with edit permission can update
            if (hasEditPermission && !isSelf) {
                user.name = req.body.name || user.name;
                user.email = req.body.email || user.email;
                user.role = req.body.role || user.role;
                user.department = req.body.department || user.department;
                user.workingHours = req.body.workingHours || user.workingHours;
                user.salary = req.body.salary !== undefined ? req.body.salary : user.salary;
                user.extraHourlyRate = req.body.extraHourlyRate !== undefined ? req.body.extraHourlyRate : user.extraHourlyRate;
                user.isOvertimeAllowed = req.body.isOvertimeAllowed !== undefined ? req.body.isOvertimeAllowed : user.isOvertimeAllowed;
                user.customRole = req.body.customRole !== undefined ? req.body.customRole : user.customRole;
            } else if (isSelf) {
                // Allow self-update for name and email, but prevent sensitive fields
                user.name = req.body.name || user.name;
                user.email = req.body.email || user.email;
                // Explicitly prevent changes to role, department, workingHours, salary for self-update
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
                workingHours: updatedUser.workingHours,
                salary: updatedUser.salary,
                extraHourlyRate: updatedUser.extraHourlyRate,
                isOvertimeAllowed: updatedUser.isOvertimeAllowed,
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

// @desc    Delete employee
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (user) {
            // Prevent deleting Admins through this endpoint
            if (user.role === 'Admin') {
                return res.status(403).json({ message: 'Admins cannot be deleted through this endpoint' });
            }

            await user.deleteOne();
            res.json({ message: 'User removed' });
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
