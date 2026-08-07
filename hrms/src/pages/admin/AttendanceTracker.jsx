import { API_BASE_URL } from '../../config';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { AttendanceTable } from './AttendanceTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Search, Filter, Download, Calendar as CalendarIcon, Info, ChevronLeft, ChevronRight, ChevronDown, User as UserIcon, Zap, Mail } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { usePermissions } from '../../context/PermissionsContext';

const AttendanceTracker = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [attendanceData, setAttendanceData] = useState([]);
    const [loading, setLoading] = useState(true);

    const employees = useMemo(() => {
        const uniqueEmpMap = new Map();
        attendanceData.forEach(r => {
            if (r.userId && r.userId._id) {
                uniqueEmpMap.set(r.userId._id, r.userId);
            }
        });
        return Array.from(uniqueEmpMap.values());
    }, [attendanceData]);
    const [selectedRecord, setSelectedRecord] = useState(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
    const [newStatus, setNewStatus] = useState('Present');
    const [customForm, setCustomForm] = useState({
        userId: '',
        date: new Date().toISOString().split('T')[0],
        checkIn: '',
        checkOut: '',
        status: 'Present'
    });
    const [updateLoading, setUpdateLoading] = useState(false);
    
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('All');
    const [allEmployees, setAllEmployees] = useState([]);
    const [filterDepartment, setFilterDepartment] = useState('All');
    const { can } = usePermissions();

    // Derive unique departments from attendance data, sorted A→Z
    const departments = useMemo(() => {
        const deptSet = new Set();
        attendanceData.forEach(r => {
            const dept = r.userId?.department;
            if (dept && dept.trim()) deptSet.add(dept.trim());
        });
        return Array.from(deptSet).sort((a, b) => a.localeCompare(b));
    }, [attendanceData]);

    // Date Filtering
    const now = new Date();
    const [filterDay, setFilterDay] = useState(String(now.getDate()).padStart(2, '0'));
    const [isDayOpen, setIsDayOpen] = useState(false);
    const [filterMonth, setFilterMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
    const [isMonthOpen, setIsMonthOpen] = useState(false);
    const [filterYear, setFilterYear] = useState(String(now.getFullYear()));
    const [isYearOpen, setIsYearOpen] = useState(false);

    useEffect(() => {
        fetchAttendance();
        fetchAllEmployees();
    }, []);

    const fetchAllEmployees = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/users`, {
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
                setAllEmployees(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error('Error fetching employees:', error);
        }
    };

    const fetchAttendance = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/attendance`, {
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
                setAttendanceData(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error('Error fetching attendance:', error);
        } finally {
            setLoading(false);
        }
    };

    const format12h = (dateStr) => {
        if (!dateStr) return '-';
        try {
            const date = new Date(dateStr);
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Karachi'
            });
        } catch (e) { return '-'; }
    };

    const calculateHours = (durationInMins) => {
        if (!durationInMins) return '-';
        const h = Math.floor(durationInMins / 60);
        const m = durationInMins % 60;
        return `${h}h ${m}m`;
    };

    // Filter Logic
    const filteredAttendance = useMemo(() => {
        return attendanceData
            .filter(r => {
                const [year, month, day] = r.date.split('-');
                const matchesYear = year === filterYear;
                const matchesMonth = filterMonth === 'All' || month === filterMonth;
                const matchesDay = filterDay === 'All' || day === filterDay;
                const matchesDate = matchesYear && matchesMonth && matchesDay;
                const matchesSearch = (r.userId?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                     (r.userId?.employeeId || '').toLowerCase().includes(searchTerm.toLowerCase());
                const matchesStatus = statusFilter === 'All' || r.status === statusFilter;
                const matchesEmployee = selectedEmployeeId === 'All' || r.userId?._id === selectedEmployeeId;
                const matchesDepartment = filterDepartment === 'All' || (r.userId?.department || '').trim() === filterDepartment;

                return matchesDate && matchesSearch && matchesStatus && matchesEmployee && matchesDepartment;
            })
            // Sort: department A→Z, then by date desc within each department
            .sort((a, b) => {
                const deptA = (a.userId?.department || '').trim().toLowerCase();
                const deptB = (b.userId?.department || '').trim().toLowerCase();
                if (deptA < deptB) return -1;
                if (deptA > deptB) return 1;
                // same dept → sort by date descending
                return b.date.localeCompare(a.date);
            });
    }, [attendanceData, filterYear, filterMonth, filterDay, searchTerm, statusFilter, selectedEmployeeId, filterDepartment]);

    const stats = useMemo(() => {
        const onTime = filteredAttendance.filter(r => r.status === 'Present').length;
        const late = filteredAttendance.filter(r => r.status === 'Late').length;
        const absent = filteredAttendance.filter(r => r.status === 'Absent').length;
        const total = filteredAttendance.length;
        const rate = total > 0 ? Math.round((onTime / total) * 100) : 0;
        return { onTime, late, absent, rate };
    }, [filteredAttendance]);

    const handleExport = () => {
        const headers = ['Date', 'Employee ID', 'Name', 'Check In', 'Check Out', 'Duration', 'Status'];
        const rows = filteredAttendance.map(r => [
            r.date,
            `"${r.userId?.employeeId || 'N/A'}"`,
            `"${r.userId?.name || 'Unknown'}"`,
            `"${r.checkIn ? format12h(r.checkIn) : '-'}"`,
            `"${r.checkOut ? format12h(r.checkOut) : '-'}"`,
            `"${calculateHours(r.duration)}"`,
            `"${r.status}"`
        ]);

        const csvContent = [headers.map(h => `"${h}"`), ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        
        let filename = `Attendance_Report_${filterMonth}_${filterYear}.csv`;
        if (selectedEmployeeId !== 'All') {
            const emp = employees.find(e => e._id === selectedEmployeeId);
            if (emp) {
                const safeName = emp.name.replace(/[^a-zA-Z0-9]/g, '_');
                filename = `Attendance_${safeName}_${filterMonth}_${filterYear}.csv`;
            }
        }
        
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleUpdateStatus = async () => {
        if (!selectedRecord) return;
        setUpdateLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/attendance/${selectedRecord._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-Role-Context': 'Admin' },
                body: JSON.stringify({ status: newStatus }),
                credentials: 'include'
            });

            if (response.ok) {
                setAttendanceData(prev => prev.map(r => r._id === selectedRecord._id ? { ...r, status: newStatus } : r));
                setIsDetailModalOpen(false);
                alert('Status updated');
            }
        } catch (error) {
            alert('Update failed');
        } finally {
            setUpdateLoading(false);
        }
    };
    
    const handleAddCustomAttendance = async (e) => {
        e.preventDefault();
        if (!customForm.userId || !customForm.date) {
            return alert("Employee and Date are required");
        }
        setUpdateLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/attendance/custom`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Role-Context': 'Admin' },
                body: JSON.stringify(customForm),
                credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
                alert('Attendance added successfully');
                setIsCustomModalOpen(false);
                fetchAttendance();
            } else {
                alert(data.message || 'Failed to add attendance');
            }
        } catch (error) {
            alert('Error adding attendance');
        } finally {
            setUpdateLoading(false);
        }
    };
    
    const handleOvertimeApproval = async (id, status, reason = '') => {
        try {
            const response = await fetch(`${API_BASE_URL}/attendance/overtime/approve/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-Role-Context': 'Admin' },
                body: JSON.stringify({ status, reason }),
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                setAttendanceData(prev => prev.map(r => r._id === id ? data.attendance : r));
                setSelectedRecord(data.attendance);
                alert(`Overtime ${status.toLowerCase()}`);
            }
        } catch (error) {
            alert('Approval failed');
        }
    };

    const [sendingReport, setSendingReport] = useState(false);

    const handleSendEmailReport = async () => {
        setSendingReport(true);
        try {
            const response = await fetch(`${API_BASE_URL}/attendance/report/send`, {
                method: 'POST',
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });
            if (response.ok) {
                alert('Report email sent successfully to all admins!');
            } else {
                alert('Failed to send report email.');
            }
        } catch (error) {
            alert('Error connecting to server.');
        } finally {
            setSendingReport(false);
        }
    };

    const months = [
        { val: 'All', label: 'All Months' },
        { val: '01', label: 'January' }, { val: '02', label: 'February' }, { val: '03', label: 'March' },
        { val: '04', label: 'April' }, { val: '05', label: 'May' }, { val: '06', label: 'June' },
        { val: '07', label: 'July' }, { val: '08', label: 'August' }, { val: '09', label: 'September' },
        { val: '10', label: 'October' }, { val: '11', label: 'November' }, { val: '12', label: 'December' }
    ];

    const days = [
        { val: 'All', label: 'All' },
        ...Array.from({ length: 31 }, (_, i) => ({ val: String(i + 1).padStart(2, '0'), label: String(i + 1) }))
    ];

    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear, currentYear + 1];

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-card p-6 rounded-2xl border border-border/40 shadow-sm">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Attendance Tracker</h1>
                    <p className="text-muted-foreground mt-1">Export and manage monthly attendance reports.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex bg-muted/50 p-1 rounded-xl border border-border/40 items-center">
                        {/* Custom Day Dropdown with Restricted Height */}
                        <div className="relative">
                            <div 
                                className="flex items-center justify-between text-sm font-semibold px-3 py-1.5 cursor-pointer min-w-[4rem]"
                                onClick={() => setIsDayOpen(!isDayOpen)}
                            >
                                <span>{days.find(d => d.val === filterDay)?.label || filterDay}</span>
                                <ChevronDown className="ml-1 h-4 w-4 opacity-50" />
                            </div>
                            
                            {isDayOpen && (
                                <>
                                    <div 
                                        className="fixed inset-0 z-40" 
                                        onClick={() => setIsDayOpen(false)}
                                    />
                                    <div className="absolute top-full left-0 mt-1 w-24 max-h-56 overflow-y-auto bg-background border border-border/40 rounded-xl shadow-xl z-50 py-1">
                                        {days.map(d => (
                                            <div 
                                                key={d.val} 
                                                className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-muted ${filterDay === d.val ? 'bg-primary/10 text-primary font-bold' : ''}`}
                                                onClick={() => {
                                                    setFilterDay(d.val);
                                                    setIsDayOpen(false);
                                                }}
                                            >
                                                {d.label}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="h-4 border-l border-border/40 mx-1"></div>

                        {/* Custom Month Dropdown */}
                        <div className="relative">
                            <div 
                                className="flex items-center justify-between text-sm font-semibold px-3 py-1.5 cursor-pointer min-w-[7rem]"
                                onClick={() => setIsMonthOpen(!isMonthOpen)}
                            >
                                <span>{months.find(m => m.val === filterMonth)?.label || filterMonth}</span>
                                <ChevronDown className="ml-1 h-4 w-4 opacity-50" />
                            </div>
                            
                            {isMonthOpen && (
                                <>
                                    <div 
                                        className="fixed inset-0 z-40" 
                                        onClick={() => setIsMonthOpen(false)}
                                    />
                                    <div className="absolute top-full left-0 mt-1 w-32 max-h-56 overflow-y-auto bg-background border border-border/40 rounded-xl shadow-xl z-50 py-1">
                                        {months.map(m => (
                                            <div 
                                                key={m.val} 
                                                className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-muted ${filterMonth === m.val ? 'bg-primary/10 text-primary font-bold' : ''}`}
                                                onClick={() => {
                                                    setFilterMonth(m.val);
                                                    setIsMonthOpen(false);
                                                }}
                                            >
                                                {m.label}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="h-4 border-l border-border/40 mx-1"></div>

                        {/* Custom Year Dropdown */}
                        <div className="relative">
                            <div 
                                className="flex items-center justify-between text-sm font-semibold px-3 py-1.5 cursor-pointer min-w-[4rem]"
                                onClick={() => setIsYearOpen(!isYearOpen)}
                            >
                                <span>{years.find(y => String(y) === String(filterYear)) || filterYear}</span>
                                <ChevronDown className="ml-1 h-4 w-4 opacity-50" />
                            </div>
                            
                            {isYearOpen && (
                                <>
                                    <div 
                                        className="fixed inset-0 z-40" 
                                        onClick={() => setIsYearOpen(false)}
                                    />
                                    <div className="absolute top-full left-0 mt-1 w-24 max-h-56 overflow-y-auto bg-background border border-border/40 rounded-xl shadow-xl z-50 py-1">
                                        {years.map(y => (
                                            <div 
                                                key={y} 
                                                className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-muted ${String(filterYear) === String(y) ? 'bg-primary/10 text-primary font-bold' : ''}`}
                                                onClick={() => {
                                                    setFilterYear(String(y));
                                                    setIsYearOpen(false);
                                                }}
                                            >
                                                {y}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    <Button 
                        onClick={() => setIsCustomModalOpen(true)}
                        variant="outline"
                        className="bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100 font-semibold"
                    >
                        + Add Custom Attendance
                    </Button>
                    <Button 
                        onClick={handleSendEmailReport} 
                        disabled={sendingReport} 
                        variant="outline" 
                        className="border-primary/50 text-primary hover:bg-primary/10 transition-all font-semibold"
                    >
                        {sendingReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                        Email Report
                    </Button>
                    <Button onClick={handleExport} className="shadow-lg shadow-primary/20 bg-primary text-primary-foreground font-semibold">
                        <Download size={18} className="mr-2" />
                        Export CSV
                    </Button>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-emerald-500/5 border-emerald-500/20">
                    <CardContent className="pt-6">
                        <div className="text-sm font-medium text-emerald-600">On Time</div>
                        <div className="text-2xl font-bold text-emerald-700">{stats.onTime}</div>
                    </CardContent>
                </Card>
                <Card className="bg-amber-500/5 border-amber-500/20">
                    <CardContent className="pt-6">
                        <div className="text-sm font-medium text-amber-600">Late</div>
                        <div className="text-2xl font-bold text-amber-700">{stats.late}</div>
                    </CardContent>
                </Card>
                <Card className="bg-rose-500/5 border-rose-500/20">
                    <CardContent className="pt-6">
                        <div className="text-sm font-medium text-rose-600">Absents</div>
                        <div className="text-2xl font-bold text-rose-700">{stats.absent}</div>
                    </CardContent>
                </Card>
                <Card className="bg-primary/5 border-primary/20">
                    <CardContent className="pt-6">
                        <div className="text-sm font-medium text-primary">On-Time Rate</div>
                        <div className="text-2xl font-bold text-primary">{stats.rate}%</div>
                    </CardContent>
                </Card>
            </div>

            {/* Filter Bar */}
            <Card className="border border-border/40 shadow-sm overflow-hidden">
                <div className="p-4">
                    <div className="flex flex-col md:flex-row items-center gap-4">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                            <Input
                                placeholder="Search by name or ID..."
                                className="pl-9 h-10 w-full shadow-sm"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-wrap gap-2 w-full md:w-auto">
                            <select
                                className="h-10 w-full md:w-48 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:ring-1 focus:ring-primary"
                                value={selectedEmployeeId}
                                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                            >
                                <option value="All">All Employees</option>
                                {employees.map(emp => (
                                    <option key={emp._id} value={emp._id}>{emp.name}{emp.employeeId ? ` (${emp.employeeId})` : ''}</option>
                                ))}
                            </select>
                            {/* Department Filter */}
                            <select
                                className="h-10 w-full md:w-44 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:ring-1 focus:ring-primary"
                                value={filterDepartment}
                                onChange={(e) => setFilterDepartment(e.target.value)}
                            >
                                <option value="All">All Departments</option>
                                {departments.map(dept => (
                                    <option key={dept} value={dept}>{dept}</option>
                                ))}
                            </select>
                            <select
                                className="h-10 w-full md:w-36 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:ring-1 focus:ring-primary"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                            >
                                <option value="All">All Status</option>
                                <option value="Present">Present</option>
                                <option value="Late">Late</option>
                                <option value="Short Hours">Short Hours</option>
                                <option value="Absent">Absent</option>
                            </select>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Main Table */}
            <Card className="border border-border/40 shadow-sm overflow-hidden">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground font-semibold">
                                <tr>
                                    <th className="px-6 py-4">Date</th>
                                    <th className="px-6 py-4">Employee</th>
                                    <th className="px-6 py-4">Department</th>
                                    <th className="px-6 py-4">Check In</th>
                                    <th className="px-6 py-4">Check Out</th>
                                    <th className="px-6 py-4">Worked</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                                <Suspense fallback={<div className="p-12 text-center text-muted-foreground"><Loader2 className="mx-auto animate-spin mb-2" /> Loading...</div>}>
                                    <AttendanceTable
                                        filteredAttendance={filteredAttendance}
                                        loading={loading}
                                        format12h={format12h}
                                        calculateHours={calculateHours}
                                        handleUpdateStatus={handleUpdateStatus}
                                        setSelectedRecord={setSelectedRecord}
                                        setIsDetailModalOpen={setIsDetailModalOpen}
                                        updateLoading={updateLoading}
                                    />
                                </Suspense>
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Detail Modal */}
            <Modal
                isOpen={isDetailModalOpen}
                onClose={() => setIsDetailModalOpen(false)}
                title="Attendance Detail"
                footer={
                    <div className="flex justify-between w-full">
                        <Button variant="ghost" onClick={() => setIsDetailModalOpen(false)}>Close</Button>
                        <Button onClick={handleUpdateStatus} disabled={updateLoading}>Update Status</Button>
                    </div>
                }
            >
                {selectedRecord && (() => {
                    const hasShifts = selectedRecord.shifts && selectedRecord.shifts.length > 0;
                    const firstCompletedShift = selectedRecord.shifts?.find(s => s.checkOut) || null;
                    const lastShift = hasShifts ? selectedRecord.shifts[selectedRecord.shifts.length - 1] : null;
                    // Summary row shows the first completed shift (the one that counts)
                    const displayCheckIn = firstCompletedShift ? firstCompletedShift.checkIn : selectedRecord.checkIn;
                    const displayCheckOut = firstCompletedShift ? firstCompletedShift.checkOut : selectedRecord.checkOut;
                    // isActive: only true when last shift is still open AND no prior shift completed
                    const isActive = selectedRecord.checkIn && !selectedRecord.checkOut && !(lastShift && lastShift.checkOut);
                    // Count only completed shift durations for the total
                    const completedDuration = hasShifts
                        ? selectedRecord.shifts.filter(s => s.checkOut && !s.missed).reduce((sum, s) => sum + (s.duration || 0), 0)
                        : selectedRecord.duration;
                    // Whether the last shift was missed (checked in, never checked out)
                    const hasOpenMissedShift = lastShift && !lastShift.checkOut && !isActive;
                    const hasMissedShift = hasShifts && selectedRecord.shifts.some(s => s.missed || (!s.checkOut && s !== lastShift));

                    return (
                    <div className="space-y-4">
                        <div className="p-4 bg-muted/30 rounded-xl flex justify-between items-center">
                            <div>
                                <p className="text-xs font-bold uppercase text-muted-foreground">Employee</p>
                                <p className="text-lg font-bold">{selectedRecord.userId?.name} {selectedRecord.userId?.status === 'Deleted' ? '(Deleted Employee)' : ''} ({selectedRecord.userId?.employeeId})</p>
                            </div>
                            {selectedRecord.userId?.status === 'Deleted' && (
                                <div className="text-right">
                                    <p className="text-xs font-bold uppercase text-muted-foreground">Employee Status</p>
                                    <Badge variant="destructive">Deleted</Badge>
                                </div>
                            )}
                        </div>

                        {/* Summary row — shows first completed shift times */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 border rounded-lg">
                                <p className="text-xs text-muted-foreground">Check In</p>
                                <p className="font-bold">{format12h(displayCheckIn)}</p>
                            </div>
                            <div className="p-3 border rounded-lg">
                                <p className="text-xs text-muted-foreground">Check Out</p>
                                <p className="font-bold">
                                    {displayCheckOut
                                        ? format12h(displayCheckOut)
                                        : isActive
                                            ? <span className="text-amber-500">Active</span>
                                            : '-'}
                                </p>
                            </div>
                        </div>

                        {/* Shifts breakdown — show whenever there are any shifts recorded */}
                        {hasShifts && (
                            <div className="space-y-2 border-t border-border/40 pt-4">
                                <p className="text-sm font-bold flex items-center gap-2">
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                                        {selectedRecord.shifts.length}
                                    </span>
                                    Shift Breakdown
                                </p>
                                <div className="rounded-lg border border-border/40 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/50 text-muted-foreground text-xs font-semibold">
                                            <tr>
                                                <th className="px-3 py-2 text-left">Shift</th>
                                                <th className="px-3 py-2 text-left">Check In</th>
                                                <th className="px-3 py-2 text-left">Check Out</th>
                                                <th className="px-3 py-2 text-left">Duration</th>
                                                <th className="px-3 py-2 text-left">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/40">
                                            {selectedRecord.shifts.map((shift, idx) => {
                                                const isMissed = shift.missed || (!shift.checkOut && !(selectedRecord.checkIn && !selectedRecord.checkOut && idx === selectedRecord.shifts.length - 1 && !firstCompletedShift));
                                                const isThisActive = !shift.checkOut && !shift.missed && selectedRecord.checkIn && !selectedRecord.checkOut && idx === selectedRecord.shifts.length - 1;
                                                return (
                                                    <tr key={idx} className={`hover:bg-muted/20 ${shift.missed ? 'bg-rose-50/40' : ''}`}>
                                                        <td className="px-3 py-2.5 text-muted-foreground font-medium">#{idx + 1}</td>
                                                        <td className="px-3 py-2.5">{shift.checkIn ? format12h(shift.checkIn) : '--:--'}</td>
                                                        <td className="px-3 py-2.5">
                                                            {shift.checkOut
                                                                ? format12h(shift.checkOut)
                                                                : isThisActive
                                                                    ? <span className="text-amber-500 font-medium">Active</span>
                                                                    : <span className="text-rose-500 font-medium">—</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-muted-foreground">
                                                            {shift.checkOut && shift.duration != null
                                                                ? `${Math.floor(shift.duration / 60)}h ${shift.duration % 60}m`
                                                                : <span className="text-muted-foreground/50">—</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            {shift.checkOut
                                                                ? <Badge variant="success">Complete</Badge>
                                                                : isThisActive
                                                                    ? <Badge variant="warning">Active</Badge>
                                                                    : <Badge variant="destructive">Missed Checkout</Badge>}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex justify-between items-center px-1 pt-1">
                                    <span className="text-xs text-muted-foreground">Total worked (completed shifts only)</span>
                                    <span className="text-sm font-bold text-primary">{calculateHours(selectedRecord.duration)}</span>
                                </div>
                            </div>
                        )}


                        {selectedRecord.overtimeIn && (
                            <div className="space-y-2 border-t border-border/40 pt-4">
                                <label className="text-sm font-bold flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-amber-500 fill-amber-500" />
                                    Overtime Request
                                </label>
                                <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-3">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Session:</span>
                                        <span className="font-bold">
                                            {format12h(selectedRecord.overtimeIn)} - {selectedRecord.overtimeOut ? format12h(selectedRecord.overtimeOut) : 'In Progress'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Status:</span>
                                        <Badge variant={
                                            selectedRecord.overtimeStatus === 'Approved' ? 'success' :
                                            selectedRecord.overtimeStatus === 'Rejected' ? 'destructive' : 'warning'
                                        }>
                                            {selectedRecord.overtimeStatus || 'Pending'}
                                        </Badge>
                                    </div>

                                    {selectedRecord.overtimeRejectReason && (
                                        <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100 italic">
                                            <strong>Reason:</strong> {selectedRecord.overtimeRejectReason}
                                        </div>
                                    )}

                                    {selectedRecord.overtimeStatus === 'Pending' && selectedRecord.overtimeOut && (
                                        <div className="flex gap-2 pt-2">
                                            <Button
                                                size="sm"
                                                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white border-none"
                                                onClick={() => handleOvertimeApproval(selectedRecord._id, 'Approved')}
                                            >
                                                Approve
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                className="flex-1"
                                                onClick={() => {
                                                    const reason = prompt('Enter rejection reason:');
                                                    if (reason !== null) handleOvertimeApproval(selectedRecord._id, 'Rejected', reason || 'Rejected by admin');
                                                }}
                                            >
                                                Reject
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-bold">Override Status</label>
                            <select 
                                className="w-full h-10 rounded-md border border-input px-3"
                                value={newStatus}
                                onChange={(e) => setNewStatus(e.target.value)}
                            >
                                <option value="Present">Present</option>
                                <option value="Absent">Absent</option>
                                <option value="Late">Late</option>
                                <option value="Short Hours">Short Hours</option>
                            </select>
                        </div>
                    </div>
                    );
                })()}
            </Modal>

            {/* Custom Add Attendance Modal */}
            <Modal
                isOpen={isCustomModalOpen}
                onClose={() => setIsCustomModalOpen(false)}
                title="Add Custom Attendance"
                footer={
                    <div className="flex justify-end gap-2 w-full">
                        <Button variant="ghost" onClick={() => setIsCustomModalOpen(false)}>Cancel</Button>
                        <Button onClick={handleAddCustomAttendance} disabled={updateLoading} className="bg-emerald-600 text-white hover:bg-emerald-700">Save Record</Button>
                    </div>
                }
            >
                <form onSubmit={handleAddCustomAttendance} className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-bold">Select Employee *</label>
                        <select 
                            className="w-full h-10 rounded-md border border-input px-3 bg-white"
                            value={customForm.userId}
                            onChange={(e) => setCustomForm({...customForm, userId: e.target.value})}
                            required
                        >
                            <option value="">-- Select Employee --</option>
                            {allEmployees.map(emp => (
                                <option key={emp._id} value={emp._id}>{emp.name} {emp.employeeId ? `(${emp.employeeId})` : ''}</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-bold">Date *</label>
                            <Input 
                                type="date" 
                                value={customForm.date}
                                onChange={(e) => setCustomForm({...customForm, date: e.target.value})}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold">Status</label>
                            <select 
                                className="w-full h-10 rounded-md border border-input px-3 bg-white"
                                value={customForm.status}
                                onChange={(e) => setCustomForm({...customForm, status: e.target.value})}
                            >
                                <option value="Present">Present</option>
                                <option value="Absent">Absent</option>
                                <option value="Late">Late</option>
                                <option value="Short Hours">Short Hours</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-bold">Check In Time</label>
                            <Input 
                                type="time" 
                                value={customForm.checkIn}
                                onChange={(e) => setCustomForm({...customForm, checkIn: e.target.value})}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold">Check Out Time</label>
                            <Input 
                                type="time" 
                                value={customForm.checkOut}
                                onChange={(e) => setCustomForm({...customForm, checkOut: e.target.value})}
                            />
                        </div>
                    </div>
                </form>
            </Modal>

        </div>
    );
};

const Loader2 = ({ className }) => <div className={`w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin ${className}`} />;

export default AttendanceTracker;
