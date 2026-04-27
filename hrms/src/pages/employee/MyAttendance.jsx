import { API_BASE_URL } from '../../config';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Calendar, Clock, Filter, Loader2 } from 'lucide-react';
import { Input } from '../../components/ui/Input';

const MyAttendance = () => {
    const [attendance, setAttendance] = useState([]);
    const [loading, setLoading] = useState(true);
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

    const format12h = (time24) => {
        if (!time24) return '--:--';
        try {
            // Handle ISO string if provided
            const date = new Date(time24);
            if (!isNaN(date.getTime())) {
                return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            }
            // Handle HH:MM string
            const [hours, minutes] = time24.split(':');
            const h = parseInt(hours);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return `${h12}:${minutes} ${ampm}`;
        } catch (e) { return time24; }
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
                                        <th className="px-4 py-4">Date</th>
                                        <th className="px-4 py-4">Check In</th>
                                        <th className="px-4 py-4">Check Out</th>
                                        <th className="px-4 py-4">Duration</th>
                                        <th className="px-4 py-4 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40">
                                    {attendance.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="p-12 text-center text-muted-foreground">
                                                No records found for this month.
                                            </td>
                                        </tr>
                                    ) : (
                                        attendance.map((record) => (
                                            <tr key={record._id} className="hover:bg-muted/30 transition-colors">
                                                <td className="px-4 py-4 font-medium">
                                                    {new Date(record.date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                </td>
                                                <td className="px-4 py-4 text-muted-foreground">
                                                    {record.checkIn ? format12h(record.checkIn) : '--:--'}
                                                </td>
                                                <td className="px-4 py-4 text-muted-foreground">
                                                    {record.checkOut ? format12h(record.checkOut) : '--:--'}
                                                </td>
                                                <td className="px-4 py-4">
                                                    {record.duration ? `${Math.floor(record.duration / 60)}h ${record.duration % 60}m` : '--'}
                                                </td>
                                                <td className="px-4 py-4 text-center">
                                                    <Badge variant={getStatusVariant(record.status)}>
                                                        {record.status}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))
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
