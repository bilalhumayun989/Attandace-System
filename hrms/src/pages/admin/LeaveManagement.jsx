import React, { useState, useEffect, useMemo } from 'react';
import { ShieldAlert, Users, Filter, CheckSquare, Edit, Save, X, Search, Loader2, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { API_BASE_URL } from '../../config';

const DAYS = [
    { label: 'Sun', value: 0 },
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thu', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 },
];

const LeaveManagement = () => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(false);
    
    // Filters State
    const [search, setSearch] = useState('');
    const [department, setDepartment] = useState('');
    const [role, setRole] = useState('');

    const [selectedIds, setSelectedIds] = useState([]);
    
    // Bulk Update Form State
    const [bulkLeaveQuota, setBulkLeaveQuota] = useState('');
    const [bulkExtraRate, setBulkExtraRate] = useState('');
    const [bulkShortHourlyRate, setBulkShortHourlyRate] = useState('');
    const [bulkOffDays, setBulkOffDays] = useState([]);

    const [message, setMessage] = useState({ text: '', type: '' });

    // Extract unique departments and roles for filters
    const departments = useMemo(() => [...new Set(employees.map(e => e.department))].filter(Boolean), [employees]);
    const roles = useMemo(() => [...new Set(employees.map(e => e.role))].filter(Boolean), [employees]);

    const fetchFilteredEmployees = async (overrides = {}) => {
        setLoading(true);
        setMessage({ text: '', type: '' });
        try {
            const res = await fetch(`${API_BASE_URL}/admin-leave/filter`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Role-Context': 'Admin'
                },
                body: JSON.stringify({ 
                    search: overrides.search !== undefined ? overrides.search : search,
                    department: overrides.department !== undefined ? overrides.department : department,
                    role: overrides.role !== undefined ? overrides.role : role
                }),
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok) {
                setEmployees(data);
                setSelectedIds([]);
            } else {
                setMessage({ text: data.message || 'Failed to fetch employees', type: 'error' });
            }
        } catch (error) {
            setMessage({ text: 'Network Error', type: 'error' });
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchFilteredEmployees();
    }, []); 

    const toggleSelect = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === employees.length) setSelectedIds([]);
        else setSelectedIds(employees.map(e => e._id));
    };

    const toggleBulkOffDay = (val) => {
        setBulkOffDays(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
    };

    const handleBulkUpdate = async () => {
        if (selectedIds.length === 0) {
            setMessage({ text: 'Select at least one employee', type: 'error' });
            return;
        }

        const payload = { employeeIds: selectedIds };
        if (bulkLeaveQuota !== '') payload.leaveQuota = Number(bulkLeaveQuota);
        if (bulkExtraRate !== '') payload.extraHourlyRate = Number(bulkExtraRate);
        if (bulkShortHourlyRate !== '') payload.shortTimeHourlyRate = Number(bulkShortHourlyRate);
        if (bulkOffDays.length > 0) payload.offDays = bulkOffDays;

        if (Object.keys(payload).length === 1) {
            setMessage({ text: 'Enter at least one field to update', type: 'error' });
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/admin-leave/bulk-update`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Role-Context': 'Admin'
                },
                body: JSON.stringify(payload),
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ text: data.message, type: 'success' });
                // Reset form
                setBulkLeaveQuota('');
                setBulkExtraRate('');
                setBulkShortHourlyRate('');
                setBulkOffDays([]);
                fetchFilteredEmployees(); // Refresh list
            } else {
                setMessage({ text: data.message || 'Update failed', type: 'error' });
            }
        } catch (error) {
            setMessage({ text: 'Network Error', type: 'error' });
        }
        setLoading(false);
    };

    const clearFilters = () => {
        setSearch('');
        setDepartment('');
        setRole('');
        // Refresh with cleared values explicitly
        fetchFilteredEmployees({ search: '', department: '', role: '' });
    };

    const handleBulkReset = async () => {
        if (selectedIds.length === 0) {
            setMessage({ text: 'Select at least one employee', type: 'error' });
            return;
        }

        if (!window.confirm(`Are you sure you want to reset rules for ${selectedIds.length} employees to factory defaults?`)) {
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/admin-leave/bulk-update`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Role-Context': 'Admin'
                },
                body: JSON.stringify({ 
                    employeeIds: selectedIds,
                    leaveQuota: 0,
                    extraHourlyRate: 0,
                    shortTimeHourlyRate: 0,
                    offDays: [0] // Reset to Sunday only off
                }),
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ text: 'Employees reset to default rules successfully', type: 'success' });
                fetchFilteredEmployees();
            } else {
                setMessage({ text: data.message || 'Reset failed', type: 'error' });
            }
        } catch (error) {
            setMessage({ text: 'Network Error', type: 'error' });
        }
        setLoading(false);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Leave & Rules Management</h2>
                    <p className="text-muted-foreground text-sm">Configure off-days, leave quotas, and hourly rates for precise payroll.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="px-3 py-1">
                        <Users className="w-3 h-3 mr-1" /> {employees.length} Total Filtered
                    </Badge>
                </div>
            </div>

            {message.text && (
                <div className={`p-4 rounded-xl text-sm font-medium flex items-center gap-2 border ${
                    message.type === 'success' 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                        : 'bg-rose-50 text-rose-700 border-rose-100'
                }`}>
                    {message.type === 'success' ? <CheckSquare className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            {/* Advanced Filters Section */}
            <Card className="border-border/50 shadow-sm bg-card/60 backdrop-blur">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Filter className="h-5 w-5 text-primary" /> Advanced Search & Filter
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Search</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    placeholder="Name or ID..." 
                                    className="pl-9"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Department</label>
                            <select 
                                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                                value={department}
                                onChange={e => setDepartment(e.target.value)}
                            >
                                <option value="">All Departments</option>
                                {departments.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</label>
                            <select 
                                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                                value={role}
                                onChange={e => setRole(e.target.value)}
                            >
                                <option value="">All Roles</option>
                                {roles.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-4 pt-2">
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" onClick={clearFilters} disabled={loading} className="text-muted-foreground">
                                <X className="w-4 h-4 mr-1" /> Clear All
                            </Button>
                            <Button onClick={fetchFilteredEmployees} disabled={loading} className="px-8 shadow-lg shadow-primary/20">
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Filter className="w-4 h-4 mr-2" />}
                                Filter Employees
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Bulk Update Section */}
            {selectedIds.length > 0 && (
                <Card className="border-primary/30 bg-primary/5 shadow-xl animate-in zoom-in-95 duration-300">
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="text-lg text-primary">Bulk Update Rules</CardTitle>
                            <CardDescription>{selectedIds.length} employees selected for modification.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={handleBulkReset} disabled={loading} className="h-8 border-rose-200 text-rose-600 hover:bg-rose-50">
                                <ShieldAlert className="w-3.5 h-3.5 mr-1.5" /> Reset to Defaults
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])} className="h-8 text-muted-foreground">
                                <X className="w-4 h-4 mr-1" /> Clear Selection
                            </Button>
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-muted-foreground">Monthly Leave Quota</label>
                                <Input 
                                    type="number" 
                                    placeholder="Default 0 (means No Leaves)" 
                                    value={bulkLeaveQuota} 
                                    onChange={e => setBulkLeaveQuota(e.target.value)} 
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-muted-foreground">Extra Hour Pay (Rs)</label>
                                <Input 
                                    type="number" 
                                    placeholder="Standard Calculation if empty" 
                                    value={bulkExtraRate} 
                                    onChange={e => setBulkExtraRate(e.target.value)} 
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-muted-foreground">Short Time Penalty (Rs/hr)</label>
                                <Input 
                                    type="number" 
                                    placeholder="Standard Calculation if empty" 
                                    value={bulkShortHourlyRate} 
                                    onChange={e => setBulkShortHourlyRate(e.target.value)} 
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5" /> Configure Weekly Off-Days
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {DAYS.map((day) => (
                                    <button
                                        key={day.value}
                                        onClick={() => toggleBulkOffDay(day.value)}
                                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border ${
                                            bulkOffDays.includes(day.value)
                                                ? 'bg-primary text-primary-foreground border-primary shadow-md'
                                                : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                                        }`}
                                    >
                                        {day.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end pt-2">
                            <Button size="lg" onClick={handleBulkUpdate} disabled={loading} className="px-10">
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                Apply To All Selected
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Employee List Table */}
            <Card className="border-border/50 shadow-md overflow-hidden bg-card/60 backdrop-blur">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead>
                            <tr className="bg-muted/30 text-muted-foreground uppercase text-[10px] font-bold tracking-widest border-b border-border/50">
                                <th className="px-6 py-4 w-10">
                                    <input 
                                        type="checkbox" 
                                        checked={employees.length > 0 && selectedIds.length === employees.length}
                                        onChange={toggleSelectAll}
                                        className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                                    />
                                </th>
                                <th className="px-6 py-4">Employee Details</th>
                                <th className="px-6 py-4">Dept / Role</th>
                                <th className="px-6 py-4">Leave Quota</th>
                                <th className="px-6 py-4">Off-Days</th>
                                <th className="px-6 py-4">Hourly Rates</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                            {loading && employees.length === 0 ? (
                                <tr><td colSpan="6" className="text-center py-20"><Loader2 className="w-10 h-10 animate-spin mx-auto text-primary opacity-20" /></td></tr>
                            ) : employees.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="text-center py-20 space-y-3">
                                        <div className="flex justify-center"><Users className="w-12 h-12 text-muted-foreground/20" /></div>
                                        <p className="text-muted-foreground font-medium">No employees found matching your criteria.</p>
                                    </td>
                                </tr>
                            ) : (
                                employees.map((emp) => (
                                    <tr key={emp._id} className={`group hover:bg-primary/5 transition-all cursor-default ${selectedIds.includes(emp._id) ? 'bg-primary/5' : ''}`}>
                                        <td className="px-6 py-4">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedIds.includes(emp._id)}
                                                onChange={() => toggleSelect(emp._id)}
                                                className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-foreground text-sm">{emp.name}</span>
                                                <span className="text-xs text-muted-foreground font-mono">{emp.employeeId}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-xs font-semibold px-2 py-0.5 bg-muted rounded-full w-fit">{emp.department}</span>
                                                <span className="text-[10px] text-muted-foreground ml-1">{emp.role}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className={`h-8 w-8 rounded-lg flex items-center justify-center font-bold text-xs border ${
                                                    emp.leaveQuota > 0 ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-muted text-muted-foreground border-border'
                                                }`}>
                                                    {emp.leaveQuota || 0}
                                                </div>
                                                <span className="text-[10px] font-medium text-muted-foreground uppercase">Leaves/mo</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex gap-1 flex-wrap max-w-[150px]">
                                                {emp.offDays && emp.offDays.length > 0 ? (
                                                    emp.offDays.sort().map(d => (
                                                        <span key={d} className="text-[10px] font-bold px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded-md border border-rose-100">
                                                            {DAYS.find(day => day.value === d)?.label}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span className="text-[10px] text-muted-foreground font-medium italic">No off-days set</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between gap-4">
                                                    <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Extra:</span>
                                                    <span className={`text-[11px] font-mono font-bold ${emp.extraHourlyRate > 0 ? 'text-emerald-600' : 'text-muted-foreground opacity-50'}`}>
                                                        {emp.extraHourlyRate > 0 ? `Rs ${emp.extraHourlyRate}/hr` : 'Standard'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-4">
                                                    <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Penalty:</span>
                                                    <span className={`text-[11px] font-mono font-bold ${emp.shortTimeHourlyRate > 0 ? 'text-amber-600' : 'text-muted-foreground opacity-50'}`}>
                                                        {emp.shortTimeHourlyRate > 0 ? `Rs ${emp.shortTimeHourlyRate}/hr` : 'Standard'}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

export default LeaveManagement;

