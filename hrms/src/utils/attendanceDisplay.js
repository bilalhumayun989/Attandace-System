const getUserKey = (record) => {
    const userId = record.userId;
    return String(userId?._id || userId || '');
};

const toDate = (value) => value ? new Date(value) : null;

const getDuration = (shift) => {
    if (Number.isFinite(shift.duration)) return shift.duration;
    const checkIn = toDate(shift.checkIn);
    const checkOut = toDate(shift.checkOut);
    return checkIn && checkOut ? Math.max(0, Math.floor((checkOut - checkIn) / 60000)) : 0;
};

const isSixAmPakistan = (value) => {
    const date = toDate(value);
    if (!date || Number.isNaN(date.getTime())) return false;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date).map(part => [part.type, part.value]));
    return parts.hour === '06' && parts.minute === '00';
};

const removeAndMergeSegments = (segments, mergedRecords) => {
    if (segments.length < 2 || new Set(segments.map(segment => segment.record)).size < 2) return;

    segments.sort((a, b) => new Date(a.shift.checkIn) - new Date(b.shift.checkIn));
    const first = segments[0];
    const last = segments[segments.length - 1];
    const mergedShift = {
        ...first.shift,
        checkIn: first.shift.sessionStart || first.shift.checkIn,
        checkOut: last.shift.checkOut || null,
        duration: segments.reduce((total, segment) => total + getDuration(segment.shift), 0),
        missed: segments.some(segment => segment.shift.missed)
    };
    if (last.shift.checkOutSource) mergedShift.checkOutSource = last.shift.checkOutSource;

    for (const { record, shift } of segments) {
        mergedRecords.add(record);
        record.shifts = record.shifts.filter(entry => entry !== shift);
        record.duration = Math.max(0, (record.duration || 0) - getDuration(shift));
    }
    first.record.shifts.push(mergedShift);
    first.record.duration = (first.record.duration || 0) + mergedShift.duration;

    for (const record of new Set(segments.map(segment => segment.record))) {
        record.shifts.sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn));
        if (record.shifts.length === 0) continue;
        record.checkIn = record.shifts[0].checkIn;
        record.checkOut = record.shifts[record.shifts.length - 1].checkOut || null;
    }
};

export const prepareAttendanceForDisplay = (attendance) => {
    const records = attendance.map(record => ({
        ...record,
        shifts: (record.shifts || []).map(shift => ({ ...shift }))
    }));
    const mergedRecords = new Set();
    const groupedBySession = new Map();

    records.forEach(record => {
        record.shifts.forEach(shift => {
            if (!shift.sessionStart) return;
            const key = `${getUserKey(record)}:${new Date(shift.sessionStart).getTime()}`;
            if (!groupedBySession.has(key)) groupedBySession.set(key, []);
            groupedBySession.get(key).push({ record, shift });
        });
    });

    groupedBySession.forEach(segments => removeAndMergeSegments(segments, mergedRecords));

    const byUserAndDate = new Map();
    records.forEach(record => {
        const key = `${getUserKey(record)}:${record.date}`;
        if (!byUserAndDate.has(key)) byUserAndDate.set(key, []);
        byUserAndDate.get(key).push(record);
    });

    const consumedShifts = new Set();
    const orderedRecords = [...records].sort((a, b) => a.date.localeCompare(b.date));
    orderedRecords.forEach(record => {
        const nextDate = new Date(`${record.date}T00:00:00Z`);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        const nextDateString = nextDate.toISOString().slice(0, 10);
        const nextRecords = byUserAndDate.get(`${getUserKey(record)}:${nextDateString}`) || [];

        for (const firstShift of record.shifts) {
            if (consumedShifts.has(firstShift) || firstShift.sessionStart || !isSixAmPakistan(firstShift.checkOut)) continue;
            for (const nextRecord of nextRecords) {
                const nextShift = nextRecord.shifts.find(shift =>
                    !consumedShifts.has(shift) &&
                    !shift.sessionStart &&
                    new Date(shift.checkIn).getTime() === new Date(firstShift.checkOut).getTime() &&
                    new Date(shift.checkOut) > new Date(shift.checkIn)
                );
                if (!nextShift) continue;
                consumedShifts.add(firstShift);
                consumedShifts.add(nextShift);
                removeAndMergeSegments([
                    { record, shift: firstShift },
                    { record: nextRecord, shift: nextShift }
                ], mergedRecords);
                break;
            }
        }
    });

    return records
        .filter(record => record.shifts.length > 0 || !mergedRecords.has(record));
};

export const formatAttendanceDateTime = (value) => {
    const date = toDate(value);
    if (!date || Number.isNaN(date.getTime())) return '--:--';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Karachi',
        day: '2-digit',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.day}-${parts.month} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
};
