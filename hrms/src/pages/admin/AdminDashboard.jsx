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

            // 1. Process Total Employees (API already filters out Admins)
            const employeesList = Array.isArray(users) ? users : [];
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
                
                const present = dayRecords.filter(a => a.status === 'Present').length;
                const late = dayRecords.filter(a => a.status === 'Late').length;
                
                // If it's a future day or today and people haven't checked in yet, don't just mark them absent if it's today and early.
                // But for simplicity in a 7-day chart, absent = total - present - late.
                let absent = totalEmployees - present - late;
                if (absent < 0) absent = 0;

                // Don't show absents for future days or if totalEmployees is 0
                if (totalEmployees === 0 || d > new Date()) {
                    absent = 0;
                }

                last7Days.push({
                    name: displayDay,
                    Present: present,
                    Late: late,
                    Absent: absent,
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
                <StatCard
                    title="Completed Checkouts"
                    value={Array.isArray(recentActivity) ? recentActivity.filter(a => a.checkOut).length.toString() : "0"}
                    description="employees finished today"
                    icon={CheckCircle}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-7 lg:grid-cols-7">
                <Card className="col-span-4 hover:shadow-lg transition-shadow border-muted/40 bg-card/60 backdrop-blur">
                    <CardHeader>
                        <CardTitle>Attendance Overview (Last 7 Days)</CardTitle>
                        <CardDescription>Visual representation of employee attendance.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2 h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                <XAxis dataKey="name" className="text-xs" tickLine={false} axisLine={false} />
                                <YAxis className="text-xs" tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                    cursor={{fill: 'rgba(0, 0, 0, 0.04)'}}
                                />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                <Bar dataKey="Present" stackId="a" fill="hsl(142.1 76.2% 36.3%)" radius={[0, 0, 4, 4]} />
                                <Bar dataKey="Late" stackId="a" fill="hsl(47.9 95.8% 53.1%)" />
                                <Bar dataKey="Absent" stackId="a" fill="hsl(0 84.2% 60.2%)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="col-span-3 hover:shadow-lg transition-shadow border-muted/40 bg-card/60 backdrop-blur">
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                        <CardDescription>Latest employee check-ins and check-outs today.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-6">
                            {recentActivity.length > 0 ? (
                                recentActivity.map((activity, index) => (
                                    <div key={index} className="flex items-center">
                                        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                                            {activity.status === 'Present' ? <CheckCircle className="h-5 w-5 text-green-500" /> : 
                                             activity.status === 'Late' ? <Clock className="h-5 w-5 text-yellow-500" /> : 
                                             <AlertCircle className="h-5 w-5 text-red-500" />}
                                        </div>
                                        <div className="ml-4 space-y-1">
                                            <p className="text-sm font-medium leading-none">{activity.userId?.name || 'Employee'}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {activity.status} • Checked In: {formatActivityTime(activity.checkIn)}
                                                {activity.checkOut ? ` • Checked Out: ${formatActivityTime(activity.checkOut)}` : ''}
                                            </p>
                                        </div>
                                        <div className="ml-auto font-medium text-sm">
                                            {activity.checkOut ? 'Completed' : 'Working'}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-sm text-muted-foreground text-center py-8">
                                    No activity recorded today.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default AdminDashboard;
