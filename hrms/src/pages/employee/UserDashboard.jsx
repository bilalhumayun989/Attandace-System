import { API_BASE_URL } from '../../config';
import React, { useState, useEffect } from 'react';
import { Clock, Calendar, CheckCircle, Coffee, XCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

import { useAuth } from '../../context/AuthContext';

const UserDashboard = () => {
    const { employeeUser: user } = useAuth();
    const [isCheckedIn, setIsCheckedIn] = useState(false);
    const [attendanceData, setAttendanceData] = useState(null);
    const [stats, setStats] = useState({ lateArrivals: 0, daysWorked: 0, todayStatus: 'Not Started', absents: 0 });
    const [elapsed, setElapsed] = useState(0);
    const [loading, setLoading] = useState(true);
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

    // Greeting based on PKT
    const getGreeting = () => {
        const hours = getPKTTime().getHours();
        if (hours < 12) return 'Good Morning';
        if (hours < 17) return 'Good Afternoon';
        return 'Good Evening';
    };

    useEffect(() => {
        fetchInitialData();
    }, []);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            // Fetch status and stats in parallel
            const [statusRes, statsRes] = await Promise.all([
                fetch(`${API_BASE_URL}/attendance/status`, {
                    headers: { 'X-Role-Context': 'Employee' },
                    credentials: 'include'
                }),
                fetch(`${API_BASE_URL}/attendance/stats`, {
                    headers: { 'X-Role-Context': 'Employee' },
                    credentials: 'include'
                })
            ]);

            const statusData = await statusRes.json();
            const statsData = await statsRes.json();

            if (statusRes.ok && statusData) {
                setAttendanceData(statusData);
                if (statusData.checkIn && !statusData.checkOut) {
                    setIsCheckedIn(true);
                    // Calculate elapsed time using absolute UTC timestamps to avoid timezone/offset bugs
                    const checkInTime = new Date(statusData.checkIn).getTime();
                    const now = new Date().getTime();
                    const seconds = Math.floor((now - checkInTime) / 1000);
                    setElapsed(seconds > 0 ? seconds : 0);
                } else if (statusData.checkOut) {
                    setElapsed(statusData.duration * 60);
                }
            }
            if (statsRes.ok) setStats(statsData);

        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

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
                headers: { 'X-Role-Context': 'Employee' },
                credentials: 'include'
            });

            const data = await response.json();

            if (response.ok) {
                if (endpoint === 'checkin') {
                    setIsCheckedIn(true);
                    setAttendanceData(data.attendance);
                } else {
                    setIsCheckedIn(false);
                    setAttendanceData(data.attendance);
                }
                setMessage({ type: 'success', text: data.message });
                fetchInitialData(); // Refresh stats
            } else {
                setMessage({ type: 'error', text: data.message });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Connection error' });
        }
    };

    const formatTime = (totalSeconds) => {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    // Check if check-in is allowed (enabled between start and start+30m)
    const isCheckInEnabled = () => {
        if (!user || isCheckedIn || (attendanceData && attendanceData.checkOut)) return false;

        const pktNow = getPKTTime();
        const [startHour, startMin] = user.workingHours.start.split(':').map(Number);
        const startTime = new Date(pktNow);
        startTime.setHours(startHour, startMin, 0, 0);

        const diffInMins = (pktNow - startTime) / (1000 * 60);

        // Allowed from start time up to 30 mins after
        return diffInMins >= 0 && diffInMins <= 30;
    };

    const todayStr = getPKTTime().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    if (loading) return <div className="flex items-center justify-center min-h-[400px]">Loading Dashboard...</div>;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Welcome Section */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{getGreeting()}, {user?.name?.split(' ')[0] || 'User'}! 👋</h1>
                    <p className="text-muted-foreground">Here's what's happening with your work today.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant={isCheckedIn ? "success" : "secondary"} className="text-sm py-1 px-3">
                        Status: {isCheckedIn ? 'Working' : (attendanceData?.checkOut ? 'Completed' : 'Logged In')}
                    </Badge>
                </div>
            </div>

            {/* Main Action Area */}
            <div className="grid gap-6 md:grid-cols-2">
                <Card className="border-border/50 shadow-md bg-card/60 backdrop-blur md:col-span-1 border-primary/10 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-32 bg-primary/5 rounded-full blur-3xl -z-10" />

                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Clock className="text-primary" />
                            Daily Attendance
                        </CardTitle>
                        <CardDescription>
                            Mark your attendance for today
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
                            <p>Office Shift: {format12h(user?.workingHours.start)} - {format12h(user?.workingHours.end)}</p>
                            {isCheckedIn && <p className="text-green-600 font-medium animate-pulse">You are currently clocked in</p>}
                            {attendanceData?.checkOut && <p className="text-blue-600 font-medium">Duty completed for today!</p>}
                        </div>
                    </CardContent>
                </Card>

                {/* Statistics Grid */}
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
                    <Card className="flex flex-col items-center justify-center p-6 bg-card/60 backdrop-blur border-border/50 hover:border-primary/20 transition-colors shadow-sm">
                        <div className="p-3 bg-blue-500/10 rounded-full mb-3 text-blue-600">
                            <Calendar size={24} />
                        </div>
                        <div className="text-2xl font-bold">{stats.daysWorked}</div>
                        <div className="text-xs text-muted-foreground uppercase font-semibold">Days Worked</div>
                    </Card>

                    <Card className="flex flex-col items-center justify-center p-6 bg-card/60 backdrop-blur border-border/50 hover:border-primary/20 transition-colors shadow-sm">
                        <div className="p-3 bg-yellow-500/10 rounded-full mb-3 text-yellow-600">
                            <Clock size={24} />
                        </div>
                        <div className="text-2xl font-bold">{stats.lateArrivals}</div>
                        <div className="text-xs text-muted-foreground uppercase font-semibold">Late Arrivals</div>
                    </Card>



                    <Card className="flex flex-col items-center justify-center p-6 bg-card/60 backdrop-blur border-border/50 hover:border-rose-100 transition-colors shadow-sm group">
                        <div className="p-3 bg-rose-500/10 rounded-full mb-3 text-rose-600 group-hover:bg-rose-500 group-hover:text-white transition-all">
                            <XCircle size={24} />
                        </div>
                        <div className="text-2xl font-bold text-rose-600">{stats.absents}</div>
                        <div className="text-xs text-muted-foreground uppercase font-semibold">Absents</div>
                    </Card>

                    <Card className="flex flex-col items-center justify-center p-6 bg-card/60 backdrop-blur border-border/50 hover:border-green-100 transition-colors shadow-sm col-span-2 lg:col-span-1">
                        <div className="p-3 bg-green-500/10 rounded-full mb-3 text-green-600">
                            <CheckCircle size={24} />
                        </div>
                        <div className="text-sm font-bold truncate max-w-full px-2" title={stats.todayStatus}>{stats.todayStatus}</div>
                        <div className="text-xs text-muted-foreground uppercase font-semibold">Today's Status</div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default UserDashboard;

