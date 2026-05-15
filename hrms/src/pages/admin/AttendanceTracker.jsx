import { API_BASE_URL } from '../../config';
import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Search, Filter, Download, Calendar as CalendarIcon, Info, ChevronLeft, ChevronRight, User as UserIcon, Zap, Mail } from 'lucide-react';
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
    const [newStatus, setNewStatus] = useState('Present');
    const [updateLoading, setUpdateLoading] = useState(false);
    
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('All');
    const { can } = usePermissions();

    // Month/Year Filtering
    const now = new Date();
    const [filterMonth, setFilterMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
    const [filterYear, setFilterYear] = useState(String(now.getFullYear()));

    useEffect(() => {
        fetchAttendance();
    }, []);

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
        return attendanceData.filter(r => {
            const [year, month] = r.date.split('-');
            const matchesDate = year === filterYear && month === filterMonth;
            const matchesSearch = (r.userId?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                 (r.userId?.employeeId || '').toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = statusFilter === 'All' || r.status === statusFilter;
            const matchesEmployee = selectedEmployeeId === 'All' || r.userId?._id === selectedEmployeeId;
            
            return matchesDate && matchesSearch && matchesStatus && matchesEmployee;
        });
    }, [attendanceData, filterYear, filterMonth, searchTerm, statusFilter, selectedEmployeeId]);

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
        { val: '01', label: 'January' }, { val: '02', label: 'February' }, { val: '03', label: 'March' },
        { val: '04', label: 'April' }, { val: '05', label: 'May' }, { val: '06', label: 'June' },
        { val: '07', label: 'July' }, { val: '08', label: 'August' }, { val: '09', label: 'September' },
        { val: '10', label: 'October' }, { val: '11', label: 'November' }, { val: '12', label: 'December' }
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
                    <div className="flex bg-muted/50 p-1 rounded-xl border border-border/40">
                        <select
                            className="bg-transparent text-sm font-semibold px-3 py-1.5 focus:outline-none cursor-pointer"
                            value={filterMonth}
                            onChange={(e) => setFilterMonth(e.target.value)}
                        >
                            {months.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
                        </select>
                        <select
                            className="bg-transparent text-sm font-semibold px-3 py-1.5 focus:outline-none border-l border-border/40 cursor-pointer"
                            value={filterYear}
                            onChange={(e) => setFilterYear(e.target.value)}
                        >
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
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
            <Card className="border border-border/40 shadow-sm">
                <CardContent className="p-4 flex flex-col md:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by name or ID..."
                            className="pl-9 h-10"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2">
                        <select
                            className="h-10 w-full md:w-48 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-primary"
                            value={selectedEmployeeId}
                            onChange={(e) => setSelectedEmployeeId(e.target.value)}
                        >
                            <option value="All">All Employees</option>
                            {employees.map(emp => (
                                <option key={emp._id} value={emp._id}>{emp.name}{emp.employeeId ? ` (${emp.employeeId})` : ''}</option>
                            ))}
                        </select>
                        <select
                            className="h-10 w-full md:w-36 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-primary"
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
                </CardContent>
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
                                    <th className="px-6 py-4">Check In</th>
                                    <th className="px-6 py-4">Check Out</th>
                                    <th className="px-6 py-4">Worked</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                                {loading ? (
                                    <tr><td colSpan="7" className="p-12 text-center text-muted-foreground"><Loader2 className="mx-auto animate-spin mb-2" /> Loading records...</td></tr>
                                ) : filteredAttendance.length === 0 ? (
                                    <tr><td colSpan="7" className="p-12 text-center text-muted-foreground">No matching records found.</td></tr>
                                ) : (
                                    filteredAttendance.map((record) => (
                                        <tr key={record._id} className="hover:bg-muted/30 transition-colors">
                                            <td className="px-6 py-4 font-medium">{record.date}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold">{record.userId?.name || 'Unknown'}</span>
                                                    <span className="text-xs text-muted-foreground">{record.userId?.employeeId}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-muted-foreground font-medium">{format12h(record.checkIn)}</td>
                                            <td className="px-6 py-4 text-muted-foreground font-medium">{format12h(record.checkOut)}</td>
                                            <td className="px-6 py-4 font-bold text-primary">{calculateHours(record.duration)}</td>
                                            <td className="px-6 py-4 text-center">
                                                <Badge variant={
                                                    (record.checkIn && !record.checkOut) ? 'destructive' :
                                                    record.status === 'Present' ? 'success' : 
                                                    record.status === 'Late' ? 'warning' : 
                                                    'destructive'
                                                }>
                                                    {(record.checkIn && !record.checkOut) ? 'Missed Checkout' : record.status}
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm"
                                                    onClick={() => { setSelectedRecord(record); setIsDetailModalOpen(true); }}
                                                >
                                                    Details
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                )}
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
                {selectedRecord && (
                    <div className="space-y-4">
                        <div className="p-4 bg-muted/30 rounded-xl">
                            <p className="text-xs font-bold uppercase text-muted-foreground">Employee</p>
                            <p className="text-lg font-bold">{selectedRecord.userId?.name} ({selectedRecord.userId?.employeeId})</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 border rounded-lg">
                                <p className="text-xs text-muted-foreground">Check In</p>
                                <p className="font-bold">{format12h(selectedRecord.checkIn)}</p>
                            </div>
                            <div className="p-3 border rounded-lg">
                                <p className="text-xs text-muted-foreground">Check Out</p>
                                <p className="font-bold">{format12h(selectedRecord.checkOut)}</p>
                            </div>
                        </div>


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
                )}
            </Modal>
        </div>
    );
};

const Loader2 = ({ className }) => <div className={`w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin ${className}`} />;

export default AttendanceTracker;
