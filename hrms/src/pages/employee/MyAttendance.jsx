import { API_BASE_URL } from '../../config';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Calendar, Clock, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Input } from '../../components/ui/Input';

const MyAttendance = () => {
    const [attendance, setAttendance] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedRows, setExpandedRows] = useState({});
    const [month, setMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    useEffect(() => {
        fetchAttendance();
    }, [month]);

    const fetchAttendance = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/attendance/my-history?month=${month}`, {
                headers: { 'X-Role-Context': 'Employee' },
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                setAttendance(data);
            }
        } catch (error) {
            console.error('Error fetching my attendance:', error);
        } finally {
            setLoading(false);
        }
    };

    const format12h = (time) => {
        if (!time) return '--:--';
        try {
            const date = new Date(time);
            if (!isNaN(date.getTime())) {
                return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            }
        } catch (e) { /* fall through */ }
        return '--:--';
    };

    const getStatusVariant = (status) => {
        switch (status) {
            case 'Present': return 'success';
            case 'Late': return 'warning';
            case 'Short Hours': return 'destructive';
            case 'Absent': return 'destructive';
            default: return 'outline';
        }
    };

    const toggleRow = (id) => {
        setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // Determine if a record has multiple shift sessions
    const hasMultipleShifts = (record) => record.shifts && record.shifts.length > 1;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-foreground">My Attendance</h2>
                    <p className="text-muted-foreground">Review your check-in history and shift details.</p>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="relative">
                        <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="month"
                            className="pl-9 w-full sm:w-[180px] bg-card border-border/40"
                            value={month}
                            onChange={(e) => setMonth(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <Card className="border-border/40 shadow-sm bg-card/60 backdrop-blur">
                <CardHeader className="pb-3">
                    <CardTitle className="text-xl">Attendance Records</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Loading records...</p>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-border/40 overflow-hidden bg-background/40">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-muted/50 text-muted-foreground font-semibold">
                                    <tr>
                                        <th className="px-4 py-4 w-8"></th>
                                        <th className="px-4 py-4">Date</th>
                                        <th className="px-4 py-4">Last Check In</th>
                                        <th className="px-4 py-4">Last Check Out</th>
                                        <th className="px-4 py-4">Total Hours</th>
                                        <th className="px-4 py-4 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40">
                                    {attendance.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" className="p-12 text-center text-muted-foreground">
                                                No records found for this month.
                                            </td>
                                        </tr>
                                    ) : (
                                        attendance.map((record) => {
                                            const isExpanded = expandedRows[record._id];
                                            const multiShift = hasMultipleShifts(record);

                                            // Determine last shift to show on the summary row
                                            const lastShift = record.shifts && record.shifts.length > 0
                                                ? record.shifts[record.shifts.length - 1]
                                                : null;

                                            const displayCheckIn = lastShift ? lastShift.checkIn : record.checkIn;
                                            const displayCheckOut = lastShift ? lastShift.checkOut : record.checkOut;

                                            return (
                                                <React.Fragment key={record._id}>
                                                    {/* Summary Row */}
                                                    <tr
                                                        className={`transition-colors ${multiShift ? 'cursor-pointer hover:bg-primary/5' : 'hover:bg-muted/30'} ${isExpanded ? 'bg-primary/5' : ''}`}
                                                        onClick={() => multiShift && toggleRow(record._id)}
                                                    >
                                                        <td className="px-4 py-4 text-muted-foreground">
                                                            {multiShift ? (
                                                                isExpanded
                                                                    ? <ChevronDown className="h-4 w-4 text-primary" />
                                                                    : <ChevronRight className="h-4 w-4" />
                                                            ) : null}
                                                        </td>
                                                        <td className="px-4 py-4 font-medium">
                                                            <div className="flex items-center gap-2">
                                                                {new Date(record.date + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                                {multiShift && (
                                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                                                                        {record.shifts.length} shifts
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4 text-muted-foreground">
                                                            {displayCheckIn ? format12h(displayCheckIn) : '--:--'}
                                                        </td>
                                                        <td className="px-4 py-4 text-muted-foreground">
                                                            {displayCheckOut ? format12h(displayCheckOut) : (record.checkIn ? <span className="text-amber-500 font-medium">Active</span> : '--:--')}
                                                        </td>
                                                        <td className="px-4 py-4 font-semibold">
                                                            {record.duration ? `${Math.floor(record.duration / 60)}h ${record.duration % 60}m` : '--'}
                                                        </td>
                                                        <td className="px-4 py-4 text-center">
                                                            <Badge variant={getStatusVariant(record.status)}>
                                                                {record.status}
                                                            </Badge>
                                                        </td>
                                                    </tr>

                                                    {/* Expanded Shift Sessions */}
                                                    {isExpanded && record.shifts && record.shifts.map((shift, idx) => (
                                                        <tr key={idx} className="bg-muted/20 border-t border-dashed border-border/30">
                                                            <td className="px-4 py-2.5"></td>
                                                            <td className="px-4 py-2.5 pl-8 text-muted-foreground text-xs font-medium">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Clock className="h-3 w-3 text-primary/60" />
                                                                    Shift {idx + 1}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-2.5 text-xs text-foreground/80">
                                                                {shift.checkIn ? format12h(shift.checkIn) : '--:--'}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-xs text-foreground/80">
                                                                {shift.checkOut ? format12h(shift.checkOut) : <span className="text-amber-500">Active</span>}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-xs text-foreground/60">
                                                                {shift.duration ? `${Math.floor(shift.duration / 60)}h ${shift.duration % 60}m` : '--'}
                                                            </td>
                                                            <td className="px-4 py-2.5"></td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default MyAttendance;
