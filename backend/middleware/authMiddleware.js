const jwt = require('jsonwebtoken');
const User = require('../models/User');

// All permissions set to true for admin
const ALL_PERMISSIONS = {
    employees: { view: true, edit: true, delete: true },
    attendance: { view: true, edit: true },
    leaves: { view: true, approve: true },
    payroll: { view: true, edit: true }
};

const protect = async (req, res, next) => {
    let token;

    const roleContext = req.headers['x-role-context'];

    // 1. Check Authorization header (Standard for scripts/mobile)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } 
    // 2. Check cookies (Standard for browsers)
    else if (roleContext === 'Admin' && req.cookies.jwt_admin) {
        token = req.cookies.jwt_admin;
    } else if (roleContext === 'Employee' && req.cookies.jwt_employee) {
        token = req.cookies.jwt_employee;
    } else {
        // Fallback: order of priority for cookies
        token = req.cookies.jwt_admin || req.cookies.jwt_employee;
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
            req.user = await User.findById(decoded.id).select('-password');

            // Attach permissions to req.user
            if (req.user) {
                if (req.user.role === 'Admin') {
                    // Admin gets all permissions
                    req.user.permissions = ALL_PERMISSIONS;
                } else {
                    // Regular employee
                    req.user.permissions = null;
                }

                // TENANCY: Attach scoped adminId to the request for easy filtering
                req.adminId = req.user.role === 'Admin' ? req.user._id : req.user.adminId;
            }

            next();
        } catch (error) {
            console.error('Token verification failed:', error);
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    } else {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
};

const admin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Not authorized' });
    }

    if (req.user.role === 'Admin') {
        next();
    } else {
        res.status(403).json({ message: 'Not authorized as an admin' });
    }
};

/**
 * Middleware factory — checks that the authenticated admin has a specific permission.
 * @param {string} module - e.g. 'employees', 'leaves', 'attendance'
 * @param {string} action - e.g. 'view', 'edit', 'delete', 'approve', 'create'
 */
const requirePermission = (module, action) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Not authorized' });
    }

    // Admins pass everything
    if (req.user.role === 'Admin') {
        return next();
    }

    // Check specific permission (usually for sub-roles, but here simplified)
    const perms = req.user.permissions;
    if (perms && perms[module] && perms[module][action]) {
        return next();
    }

    return res.status(403).json({
        message: `You do not have permission to perform this action (${module}.${action})`
    });
};

module.exports = { protect, admin, requirePermission };
