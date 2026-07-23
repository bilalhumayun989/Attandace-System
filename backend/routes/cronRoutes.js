const express = require('express');
const router = express.Router();
const { sendDailyReport, runAutoCheckOut, autoGenerateAndSendPayroll } = require('../utils/reportCron');

// Security middleware for cron endpoints
const verifyCronSecret = (req, res, next) => {
    // If CRON_SECRET is defined in env, enforce authorization header or secret query parameter
    const secret = process.env.CRON_SECRET;
    if (secret) {
        const authHeader = req.headers.authorization;
        const queryKey = req.query.key;
        const isVercelCron = req.headers['x-vercel-cron'] === '1';

        if (!isVercelCron && authHeader !== `Bearer ${secret}` && queryKey !== secret) {
            return res.status(401).json({ message: 'Unauthorized cron trigger: Invalid secret' });
        }
    }
    next();
};

router.use(verifyCronSecret);

// Route to trigger Daily Report
router.all('/daily-report', async (req, res) => {
    try {
        console.log('[Cron Route] Triggering daily report via endpoint');
        const result = await sendDailyReport();
        res.json({ message: 'Daily report triggered successfully', result });
    } catch (error) {
        console.error('[Cron Route Error] Daily report failed:', error);
        res.status(500).json({ message: 'Daily report execution failed', error: error.message });
    }
});

// Route to trigger Auto Checkout
router.all('/auto-checkout', async (req, res) => {
    try {
        console.log('[Cron Route] Triggering auto-checkout via endpoint');
        await runAutoCheckOut();
        res.json({ message: 'Auto checkout executed successfully' });
    } catch (error) {
        console.error('[Cron Route Error] Auto checkout failed:', error);
        res.status(500).json({ message: 'Auto checkout execution failed', error: error.message });
    }
});

// Route to trigger Auto Payroll
router.all('/auto-payroll', async (req, res) => {
    try {
        const cycle = parseInt(req.query.cycle || req.body.cycle || '15', 10);
        const monthOffset = parseInt(req.query.monthOffset || req.body.monthOffset || '0', 10);
        console.log(`[Cron Route] Triggering auto-payroll for cycle ${cycle} via endpoint`);
        await autoGenerateAndSendPayroll(cycle, monthOffset);
        res.json({ message: `Auto payroll executed for cycle ${cycle}` });
    } catch (error) {
        console.error('[Cron Route Error] Auto payroll failed:', error);
        res.status(500).json({ message: 'Auto payroll execution failed', error: error.message });
    }
});

module.exports = router;
