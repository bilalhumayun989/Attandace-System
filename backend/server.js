const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const userRoutes = require('./routes/userRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');

// Load environment variables
dotenv.config();

// Start cron jobs
require('./utils/reportCron');

// Connect to Database (Initial attempt, do not block)
connectDB().catch(err => console.error("Initial DB Connection failed:", err.message));

const app = express();

// Middleware
// const allowedOrigins = [
//     process.env.FRONTEND_URL?.replace(/\/$/, ''),
//     'http://localhost:5173'
// ].filter(Boolean);

const allowedOrigins = [
    // Extract just origin (scheme+host) from FRONTEND_URL, strip any path
    process.env.FRONTEND_URL 
        ? new URL(process.env.FRONTEND_URL).origin 
        : null,
    'http://localhost:5173'
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const sanitizedOrigin = origin.replace(/\/$/, '');
        if (allowedOrigins.includes(sanitizedOrigin)) {
            callback(null, true);
        } else {
            console.log('CORS Blocked Origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Role-Context']
}));
app.use(express.json());
app.use(cookieParser());

// Serverless DB connection middleware
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        return res.status(500).json({ 
            message: 'Database connection failed. Please check Vercel environment variables and MongoDB IP Whitelist.', 
            error: err.message 
        });
    }
});

// Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/attendance', require('./routes/attendanceRoutes'));
app.use('/api/payroll', require('./routes/payrollRoutes'));
app.use('/api/admin-leave', require('./routes/leaveRoutes'));


// Basic route
app.get('/', (req, res) => {
    res.send('HRMS API is running...');
});

// Export for Vercel
module.exports = app;

// Conditional listen for local development
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

