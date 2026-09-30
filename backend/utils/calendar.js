// Validate before parsing: JavaScript otherwise rolls February 30 into March.
const isValidCalendarDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const getMonthEnd = (month) => {
    if (!isValidCalendarDate(`${month}-01`)) return null;
    const date = new Date(`${month}-01T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return date.toISOString().slice(0, 10);
};

module.exports = { isValidCalendarDate, getMonthEnd };
