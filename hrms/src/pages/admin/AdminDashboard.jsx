import React, { useState, useEffect } from 'react';
import { Users, Clock, AlertCircle, FileText, Loader2, Calendar, CheckCircle, Coffee, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { API_BASE_URL } from '../../config';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../../context/AuthContext';

const StatCard = ({ title, value, description, icon: Icon, trend }) => (
    <Card className="hover:shadow-lg transition-shadow border-muted/40 bg-card/60 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
            <Icon className="h-4 w-4 text-primary" />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold tracking-tight">{value}</div>
            <p className="text-xs text-muted-foreground mt-1">
                {trend && <span className={trend.startsWith('+') ? 'text-green-500 font-medium' : 'text-red-500 font-medium'}>{trend} </span>}
                {description}
            </p>
        </CardContent>
    </Card>
);

const AdminDashboard = () => {
    const { adminUser: user } = useAuth();
    const [stats, setStats] = useState({
        totalEmployees: 0,
        attendanceToday: 0,
        lateArrivals: 0,
    });
    const [recentActivity, setRecentActivity] = useState([]);
    const [chartData, setChartData] = useState([]);
    const [loading, setLoading] = useState(true);

    // Attendance state for Admin self-marking
    const [isCheckedIn, setIsCheckedIn] = useState(false);
    const [attendanceData, setAttendanceData] = useState(null);
    const [elapsed, setElapsed] = useState(0);
    const [message, setMessage] = useState({ type: '', text: '' });

    const getPKTTime = () => {
        return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
    };

    const format12h = (time24) => {
        if (!time24) return '';
        const [hours, minutes] = time24.split(':');
        const h = parseInt(hours);
        const m = minutes;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${m} ${ampm}`;
    };

    const formatTime = (totalSeconds) => {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const fetchDashboardData = async () => {
        try {
            // Fetch data in parallel
            const [usersRes, attendanceRes, statusRes] = await Promise.all([
                fetch(`${API_BASE_URL}/users`, { headers: { 'X-Role-Context': 'Admin' }, credentials: 'include' }),
                fetch(`${API_BASE_URL}/attendance`, { headers: { 'X-Role-Context': 'Admin' }, credentials: 'include' }),
                fetch(`${API_BASE_URL}/attendance/status`, { headers: { 'X-Role-Context': 'Admin' }, credentials: 'include' })
            ]);

            const users = usersRes.ok ? await usersRes.json() : [];
            const attendance = attendanceRes.ok ? await attendanceRes.json() : [];
            const statusData = statusRes.ok ? await statusRes.json() : null;

            // 1. Process Total Employees (Only Employee role)
            const employeesList = Array.isArray(users) ? users.filter(u => u.role === 'Employee') : [];
            const totalEmployees = employeesList.length;

            // 2. Process Today's Attendance & Late Arrivals
            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
            const todaysAttendance = Array.isArray(attendance) ? attendance.filter(a => a.date === today) : [];
            const checkedInToday = todaysAttendance.filter(a => a.checkIn).length;
            const lateArrivals = todaysAttendance.filter(a => a.status === 'Late').length;



            setStats({
                totalEmployees,
                attendanceToday: checkedInToday,
                lateArrivals,
            });

            // 4. Admin self-attendance status
            if (statusRes.ok && statusData) {
                setAttendanceData(statusData);
                if (statusData.checkIn && !statusData.checkOut) {
                    setIsCheckedIn(true);
                    
                    // Calculate total break time so far
                    let breakSeconds = 0;
                    if (statusData.breaks) {
                        statusData.breaks.forEach(b => {
                            if (b.start && b.end) {
                                breakSeconds += Math.floor((new Date(b.end) - new Date(b.start)) / 1000);
                            } else if (b.start && !b.end) {
                                // Currently on break
                                breakSeconds += Math.floor((new Date().getTime() - new Date(b.start).getTime()) / 1000);
                            }
                        });
                    }

                    const checkInTime = new Date(statusData.checkIn).getTime();
                    const now = new Date().getTime();
                    const totalSeconds = Math.floor((now - checkInTime) / 1000);
                    const workSeconds = totalSeconds - breakSeconds;
                    setElapsed(workSeconds > 0 ? workSeconds : 0);
                } else if (statusData.checkOut) {
                    setElapsed(statusData.duration * 60);
                    setIsCheckedIn(false);
                }
            } else {
                setIsCheckedIn(false);
                setAttendanceData(null);
                setElapsed(0);
            }

            // 5. Process Recent Activity
            const activityList = Array.isArray(attendance) ? attendance
                .filter(a => a.checkIn)
                .sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())
                .slice(0, 5) : [];
            setRecentActivity(activityList);

            // 6. Process Chart Data
            const last7Days = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const dateStr = `${yyyy}-${mm}-${dd}`;
                const displayDay = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
                const dayRecords = Array.isArray(attendance) ? attendance.filter(a => a.date === dateStr) : [];
                last7Days.push({
                    name: displayDay,
                    Present: dayRecords.filter(a => a.status === 'Present').length,
                    Late: dayRecords.filter(a => a.status === 'Late').length,
                    Absent: dayRecords.filter(a => a.status === 'Absent').length,
                });
            }
            setChartData(last7Days);

        } catch (error) {
            console.error('Error fetching admin dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboardData();
    }, []);

    // Timer Logic
    useEffect(() => {
        let interval;
        const lastBreak = attendanceData?.breaks?.[attendanceData.breaks.length - 1];
        const isOnBreak = lastBreak && !lastBreak.end;

        if (isCheckedIn && !isOnBreak && !attendanceData?.checkOut) {
            interval = setInterval(() => {
                setElapsed((prev) => prev + 1);
            }, 1000);
        } else {
            clearInterval(interval);
        }
        return () => clearInterval(interval);
    }, [isCheckedIn, attendanceData]);

    const handleAttendanceAction = async () => {
        const endpoint = isCheckedIn ? 'checkout' : 'checkin';
        try {
            const response = await fetch(`${API_BASE_URL}/attendance/${endpoint}`, {
                method: 'POST',
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
                setMessage({ type: 'success', text: data.message });
                fetchDashboardData();
            } else {
                setMessage({ type: 'error', text: data.message });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Connection error' });
        }
    };

    const formatActivityTime = (isoString) => {
        if (!isoString) return '';
        const d = new Date(isoString);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const lastBreak = attendanceData?.breaks?.[attendanceData.breaks.length - 1];
    const isOnBreak = lastBreak && !lastBreak.end;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
                    <p className="text-muted-foreground">Overview of your company's performance.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={() => window.location.href='/admin/enroll-face'} variant="outline" className="shadow-sm">
                        Enroll Employee Face
                    </Button>
                    <Badge variant={isOnBreak ? "warning" : (isCheckedIn ? "success" : "secondary")} className="text-sm py-1 px-3">
                        My Status: {isOnBreak ? 'On Break' : (isCheckedIn ? 'Working' : (attendanceData?.checkOut ? 'Completed' : 'Offline'))}
                    </Badge>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="Total Employees"
                    value={stats.totalEmployees.toString()}
                    description="active employees"
                    icon={Users}
                />
                <StatCard
                    title="Attendance Today"
                    value={stats.attendanceToday.toString()}
                    description="checked in today"
                    icon={Clock}
                />
                <StatCard
                    title="Late Arrivals"
                    value={stats.lateArrivals.toString()}
                    description="arrived late today"
                    icon={AlertCircle}
                />

            </div>
        </div>
    );
};

export default AdminDashboard;
