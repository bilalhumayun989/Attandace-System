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
                    const checkInTime = new Date(statusData.checkIn).getTime();
                    const now = new Date().getTime();
                    const seconds = Math.floor((now - checkInTime) / 1000);
                    setElapsed(seconds > 0 ? seconds : 0);
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
        if (isCheckedIn) {
            interval = setInterval(() => {
                setElapsed((prev) => prev + 1);
            }, 1000);
        } else {
            clearInterval(interval);
        }
        return () => clearInterval(interval);
    }, [isCheckedIn]);

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

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
                    <p className="text-muted-foreground">Overview of your company's performance.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant={isCheckedIn ? "success" : "secondary"} className="text-sm py-1 px-3">
                        My Status: {isCheckedIn ? 'Working' : (attendanceData?.checkOut ? 'Completed' : 'Offline')}
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

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
                {/* Admin Self Attendance Marking */}
                <Card className="col-span-4 border-border/50 shadow-md bg-card/60 backdrop-blur border-primary/10 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-32 bg-primary/5 rounded-full blur-3xl -z-10" />
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Clock className="text-primary" />
                            My Daily Attendance
                        </CardTitle>
                        <CardDescription>
                            Mark your attendance as an Admin
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center justify-center py-6 space-y-6">
                        {message.text && (
                            <div className={`p-3 w-full rounded-md text-sm text-center ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {message.text}
                            </div>
                        )}
                        <div className="text-5xl font-mono font-bold tracking-widest text-foreground">
                            {formatTime(elapsed)}
                        </div>
                        <Button
                            onClick={handleAttendanceAction}
                            size="lg"
                            className={`w-48 h-16 text-lg rounded-full shadow-xl transition-all duration-300 transform hover:scale-105 ${isCheckedIn
                                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 border-2 border-destructive/20'
                                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/25'
                                }`}
                        >
                            {isCheckedIn ? 'Check Out' : 'Check In'}
                        </Button>
                        <div className="text-sm text-muted-foreground text-center space-y-1">
                            <p>Shift: {format12h(user?.workingHours?.start)} - {format12h(user?.workingHours?.end)}</p>
                            {isCheckedIn && <p className="text-green-600 font-medium animate-pulse">You are currently clocked in</p>}
                            {attendanceData?.checkOut && <p className="text-blue-600 font-medium">Duty completed for today!</p>}
                        </div>
                    </CardContent>
                </Card>

                {/* Attendance Overview Chart */}
                <Card className="col-span-3 border-muted/40 shadow-sm">
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                        <CardDescription>Latest employee check-ins.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-6">
                            {recentActivity.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">No recent activity detected.</p>
                            ) : (
                                recentActivity.map((record) => {
                                    const actUser = record.userId || { name: 'Unknown User', department: 'Unknown' };
                                    const init = actUser.name ? actUser.name.charAt(0) : 'U';
                                    return (
                                        <div key={record._id || Math.random()} className="flex items-center gap-4">
                                            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs ring-2 ring-background shadow-sm">
                                                {init}
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-sm font-medium leading-none">{actUser.name} checked in</p>
                                                <p className="text-xs text-muted-foreground">{formatActivityTime(record.checkIn)} {actUser.department && `- ${actUser.department}`}</p>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="col-span-7 border-muted/40 shadow-sm">
                    <CardHeader>
                        <CardTitle>Attendance Overview</CardTitle>
                        <CardDescription>Last 7 days attendance summary.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} allowDecimals={false} />
                                    <Tooltip 
                                        cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
                                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                                    />
                                    <Legend wrapperStyle={{ paddingTop: '10px' }} />
                                    <Bar dataKey="Present" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} name="Present" />
                                    <Bar dataKey="Late" stackId="a" fill="#f59e0b" name="Late" />

                                    <Bar dataKey="Absent" stackId="a" fill="#f43f5e" radius={[4, 4, 0, 0]} name="Absent" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default AdminDashboard;
