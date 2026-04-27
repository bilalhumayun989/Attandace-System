const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/userController');
const { protect, admin, requirePermission } = require('../middleware/authMiddleware');

// Route to add a new employee (Admin + employees.edit permission)
router.post('/add', protect, admin, requirePermission('employees', 'edit'), createEmployee);

// Route to get all employees (Admin + employees.view permission)
router.get('/', protect, admin, requirePermission('employees', 'view'), getEmployees);

// Route to get current user info
router.get('/me', protect, getMe);

// Route to logout
router.post('/logout', logoutUser);

// Route to update/delete employee
router.route('/:id')
    .put(protect, updateUser)  // updateUser handles its own permission checks (self or admin)
    .delete(protect, admin, requirePermission('employees', 'delete'), deleteUser);

// Route to login
router.post('/login', loginUser);

// Route to register admin
router.post('/register', registerAdmin);

// Route to verify email
router.get('/verify-email/:token', verifyEmail);

// Route to resend verification email
router.post('/resend-verification', resendVerification);

// Route to forgot password
router.post('/forgot-password', forgotPassword);

// Route to reset password
router.put('/reset-password/:token', resetPassword);

module.exports = router;

