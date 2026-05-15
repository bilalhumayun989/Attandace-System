import { API_BASE_URL } from '../../config';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Loader2, DollarSign, Calendar, Download, Trash2, Settings2, ChevronDown, ChevronUp, User } from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';

const PayrollManagement = () => {
    const [loading, setLoading] = useState(false);
    const [generatingCycle, setGeneratingCycle] = useState(null);
    const [payrolls, setPayrolls] = useState([]);
    const [expandedPayrollId, setExpandedPayrollId] = useState(null);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showDailyBreakdownId, setShowDailyBreakdownId] = useState(null);
    const { can } = usePermissions();

    // Default to current month YYYY-MM
    const getCurrentMonth = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    };

    const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('All');
    const [employees, setEmployees] = useState([]);

    useEffect(() => {
        fetchPayrolls();
        fetchEmployees();
    }, [selectedMonth]);

    const fetchEmployees = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/users`, {
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
                setEmployees(Array.isArray(data) ? data.filter(u => u.role !== 'Admin') : []);
            }
        } catch (error) {
            console.error('Error fetching employees:', error);
        }
    };

    const fetchPayrolls = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/payroll?month=${selectedMonth}`, {
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
                setPayrolls(data);
            }
        } catch (error) {
            console.error('Error fetching payrolls:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleGeneratePayroll = async (cycle, isCustom = false) => {
        if (isCustom && (!customStart || !customEnd)) {
            alert('Please select both start and end dates');
            return;
        }

        setGeneratingCycle(cycle || 'custom');
        try {
            const response = await fetch(`${API_BASE_URL}/payroll/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Role-Context': 'Admin'
                },
                credentials: 'include',
                body: JSON.stringify({ 
                    month: selectedMonth, 
                    userId: selectedEmployeeId !== 'All' ? selectedEmployeeId : undefined,
                    cycle: cycle,
                    customStart: isCustom ? customStart : undefined,
                    customEnd: isCustom ? customEnd : undefined
                })
            });

            if (response.ok) {
                // Refresh list
                fetchPayrolls();
                alert(isCustom ? 'Custom range payroll generated!' : `Payroll generated successfully for cycle till ${cycle}th!`);
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to generate payroll');
            }
        } catch (error) {
            console.error('Error generating payroll:', error);
            alert('Error connecting to server');
        } finally {
            setGeneratingCycle(null);
        }
    };

    const markAsPaid = async (payrollId) => {
        if (!window.confirm('Confirm Payment: Are you sure you want to mark this payroll as PAID? This action will finalize the record.')) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/payroll/${payrollId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Role-Context': 'Admin'
                },
                body: JSON.stringify({ status: 'Paid' }),
                credentials: 'include'
            });

            if (response.ok) {
                fetchPayrolls();
                alert('Success: Payroll has been marked as paid.');
            }
        } catch (error) {
            console.error('Error updating payroll status:', error);
            alert('Error: Could not update payment status.');
        }
    };

    const handleDeletePayroll = async (payrollId) => {
        if (!window.confirm('Are you sure you want to delete this payroll record?')) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/payroll/${payrollId}`, {
                method: 'DELETE',
                headers: {
                    'X-Role-Context': 'Admin'
                },
                credentials: 'include'
            });

            if (response.ok) {
                fetchPayrolls();
            } else {
                alert('Failed to delete payroll');
            }
        } catch (error) {
            console.error('Error deleting payroll:', error);
        }
    };

    const handleDeleteAllPayrolls = async () => {
        if (!window.confirm('CRITICAL: Are you sure you want to delete ALL payroll records? This action cannot be undone.')) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/payroll/delete-all`, {
                method: 'DELETE',
                headers: {
                    'X-Role-Context': 'Admin'
                },
                credentials: 'include'
            });

            if (response.ok) {
                fetchPayrolls();
                alert('All payroll records deleted successfully');
            } else {
                alert('Failed to delete all payrolls');
            }
        } catch (error) {
            console.error('Error deleting all payrolls:', error);
        }
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-PK', {
            style: 'currency',
            currency: 'PKR',
            minimumFractionDigits: 0
        }).format(amount);
    };

    const filteredPayrolls = payrolls.filter(p => {
        if (selectedEmployeeId === 'All') return true;
        return p.userId?._id === selectedEmployeeId;
    });

    const toggleExpand = (id) => {
        if (expandedPayrollId === id) {
            setExpandedPayrollId(null);
        } else {
            setExpandedPayrollId(id);
        }
    };

    return (
        <div className="p-4 md:p-8 space-y-8 bg-slate-50/30 min-h-screen">
            {/* Header Section */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div className="space-y-1">
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight">Payroll Management</h1>
                    <p className="text-slate-500 font-medium">Manage monthly salaries, attendance reconciliation, and automated deductions.</p>
                </div>
                
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 border-b sm:border-b-0 sm:border-r border-slate-100 hover:bg-slate-50/50 transition-colors">
                        <div className="bg-blue-50 p-2 rounded-lg">
                            <Calendar className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Period</span>
                            <Input
                                type="month"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="h-7 border-none bg-transparent p-0 focus-visible:ring-0 font-bold text-slate-700 text-sm shadow-none"
                            />
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50 transition-colors">
                        <div className="bg-emerald-50 p-2 rounded-lg">
                            <User className="h-4 w-4 text-emerald-600" />
                        </div>
                        <div className="flex flex-col flex-1">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Employee Filter</span>
                            <select
                                value={selectedEmployeeId}
                                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                                className="bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700 cursor-pointer min-w-[180px] p-0 h-7"
                            >
                                <option value="All">All Staff Members</option>
                                {employees.map(emp => (
                                    <option key={emp._id} value={emp._id}>{emp.name} {emp.employeeId ? `(${emp.employeeId})` : ''}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 py-2">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <Button
                            onClick={() => handleGeneratePayroll(7)}
                            disabled={generatingCycle !== null}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 px-6 rounded-xl rounded-r-none border-r border-emerald-500 whitespace-nowrap transition-all active:scale-95"
                        >
                            {generatingCycle === 7 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}
                            Calculate Till 7th
                        </Button>
                        <Button
                            onClick={() => handleGeneratePayroll(22)}
                            disabled={generatingCycle !== null}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 px-6 rounded-xl rounded-l-none whitespace-nowrap transition-all active:scale-95"
                        >
                            {generatingCycle === 22 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}
                            Calculate Till 22nd
                        </Button>
                    </div>

                    <Button
                        variant="outline"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className={`h-11 px-6 rounded-2xl border-2 border-dashed transition-all whitespace-nowrap font-bold ${showAdvanced ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-200' : 'text-slate-500 hover:border-slate-400'}`}
                    >
                        <Settings2 className={`mr-2 h-4 w-4 ${showAdvanced ? 'animate-spin-slow' : ''}`} />
                        {showAdvanced ? 'Hide Advanced Tools' : 'Advanced Options'}
                        {showAdvanced ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
                    </Button>
                </div>
            </div>



            {/* Advanced Tools Panel */}
            {showAdvanced && (
                <div className="mb-6 p-4 bg-white rounded-2xl border border-blue-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-blue-100 p-2 rounded-lg">
                                <Calendar className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-blue-900 uppercase tracking-wider">Custom Range Calculation</p>
                                <p className="text-[10px] text-blue-500">Generate payroll for any specific window of dates</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 bg-blue-50/50 p-1.5 rounded-xl border border-blue-100/50">
                            <Input 
                                type="date" 
                                className="h-9 text-xs w-[140px] bg-white border-blue-100" 
                                value={customStart}
                                onChange={(e) => setCustomStart(e.target.value)}
                            />
                            <span className="text-blue-300 font-bold">TO</span>
                            <Input 
                                type="date" 
                                className="h-9 text-xs w-[140px] bg-white border-blue-100" 
                                value={customEnd}
                                onChange={(e) => setCustomEnd(e.target.value)}
                            />
                            <Button 
                                onClick={() => handleGeneratePayroll(null, true)}
                                disabled={generatingCycle !== null}
                                className="h-9 bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 rounded-lg"
                            >
                                {generatingCycle === 'custom' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run Calculation'}
                            </Button>
                        </div>

                        {can('payroll', 'edit') && payrolls.length > 0 && (
                            <div className="pl-4 border-l border-muted/30">
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={handleDeleteAllPayrolls}
                                    className="bg-rose-50/50 hover:bg-rose-500 text-rose-600 hover:text-white border border-rose-100 hover:border-rose-600 transition-all h-10 px-4 font-bold text-xs uppercase tracking-widest rounded-xl"
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Clear History
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <Card className="border-muted/40 shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle>Payroll Records for {selectedMonth}</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="rounded-md border border-muted/40 overflow-x-auto">
                            <table className="w-full text-sm text-left whitespace-nowrap min-w-[1000px]">
                                <thead className="bg-muted/50 text-muted-foreground font-medium">
                                    <tr>
                                        <th className="h-10 px-4 py-3 align-middle">Employee</th>
                                        <th className="h-10 px-4 py-3 align-middle">Department</th>
                                        <th className="h-10 px-4 py-3 align-middle">Generated At</th>
                                        <th className="h-10 px-4 py-3 align-middle">Base Salary</th>
                                        <th className="h-10 px-4 py-3 align-middle text-center">Lates</th>
                                        <th className="h-10 px-4 py-3 align-middle text-center">Absents</th>
                                        <th className="h-10 px-4 py-3 align-middle text-center">Overtime</th>
                                        <th className="h-10 px-4 py-3 align-middle text-right">Deductions</th>
                                        <th className="h-10 px-4 py-3 align-middle text-right">Net Salary</th>

                                        <th className="h-10 px-4 py-3 align-middle text-center">Status</th>
                                        <th className="h-10 px-4 py-3 align-middle text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40 bg-card">
                                    {filteredPayrolls.length === 0 ? (
                                        <tr>
                                            <td colSpan="11" className="p-8 text-center text-muted-foreground">
                                                No payroll records found for this selection.
                                                <br />
                                                Click "Generate Payroll" to calculate.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredPayrolls.map((payroll) => (
                                            <React.Fragment key={payroll._id}>
                                                <tr 
                                                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                                                    onClick={() => toggleExpand(payroll._id)}
                                                    title="Click to view calculation breakdown"
                                                >
                                                    <td className="p-4 align-middle font-medium">
                                                        {payroll.userId?.name || 'Unknown'}
                                                        <div className="text-xs text-muted-foreground font-normal">{payroll.userId?.role}</div>
                                                    </td>
                                                    <td className="p-4 align-middle">
                                                        <Badge variant="secondary" className="font-normal">{payroll.userId?.department}</Badge>
                                                    </td>
                                                    <td className="p-4 align-middle text-xs text-muted-foreground whitespace-nowrap">
                                                        {new Date(payroll.createdAt || new Date()).toLocaleString('en-US', {
                                                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                                        })}
                                                    </td>
                                                    <td className="p-4 align-middle">
                                                        {formatCurrency(payroll.salary)}
                                                    </td>
                                                    <td className="p-4 align-middle text-center">
                                                        {payroll.totalLates}
                                                        {payroll.deductions?.lateDeduction > 0 &&
                                                            <span className="block text-xs text-rose-500">(-{formatCurrency(payroll.deductions.lateDeduction)})</span>
                                                        }
                                                    </td>
                                                    <td className="p-4 align-middle text-center">
                                                        {payroll.totalAbsents}
                                                        {payroll.deductions?.absentDeduction > 0 &&
                                                            <span className="block text-xs text-rose-500">(-{formatCurrency(payroll.deductions.absentDeduction)})</span>
                                                        }
                                                    </td>
                                                    <td className="p-4 align-middle text-center">
                                                        <div className="flex flex-col items-center">
                                                            <span className="font-medium text-blue-600">
                                                                {Math.floor((payroll.overtime?.minutes || 0) / 60)}h {(payroll.overtime?.minutes || 0) % 60}m
                                                            </span>
                                                            {payroll.overtime?.pay > 0 && (
                                                                <span className="text-xs text-emerald-600">+{formatCurrency(payroll.overtime.pay)}</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 align-middle text-right text-rose-600 font-medium">
                                                        {formatCurrency(payroll.deductions?.totalDeduction || 0)}
                                                    </td>

                                                    <td className="p-4 align-middle text-right font-bold text-emerald-600">
                                                        {formatCurrency(payroll.netSalary)}
                                                    </td>
                                                    <td className="p-4 align-middle text-center" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex flex-col items-center gap-1">
                                                            <Badge variant={payroll.status === 'Paid' ? 'success' : 'outline'} className={payroll.status === 'Pending' ? 'text-amber-600 border-amber-200 bg-amber-50' : ''}>
                                                                {payroll.status}
                                                            </Badge>
                                                            {payroll.status === 'Paid' && payroll.paidAt && (
                                                                <span className="text-[10px] text-slate-400 font-medium">
                                                                    {new Date(payroll.paidAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 align-middle text-right flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                                        {payroll.status === 'Pending' && can('payroll', 'edit') && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 text-xs hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200"
                                                                onClick={() => markAsPaid(payroll._id)}
                                                            >
                                                                Mark as Paid
                                                            </Button>
                                                        )}
                                                        {can('payroll', 'edit') && (
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                                                                onClick={() => handleDeletePayroll(payroll._id)}
                                                                title="Delete Payroll"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </td>
                                                </tr>
                                                {expandedPayrollId === payroll._id && (
                                                    <tr className="bg-muted/10 border-b border-muted">
                                                        <td colSpan="11" className="p-6">
                                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                                {/* Basis */}
                                                                <div className="space-y-3 bg-white p-4 rounded-md shadow-sm border border-border/50">
                                                                    <h4 className="font-semibold text-sm border-b pb-2 flex items-center gap-2">
                                                                        <Calendar className="h-4 w-4 text-blue-500" />
                                                                        Calculation Basis
                                                                    </h4>
                                                                    <div className="space-y-1">
                                                                        {payroll.calculationStartDate && payroll.calculationEndDate && (
                                                                            <div className="flex justify-between text-sm bg-blue-50/50 p-1.5 rounded-sm border border-blue-100 mb-2">
                                                                                <span className="text-blue-700 font-medium text-[13px]">Calculation Period:</span>
                                                                                <span className="font-bold text-blue-800 text-[13px]">
                                                                                    {new Date(payroll.calculationStartDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} 
                                                                                    {' - '} 
                                                                                    {new Date(payroll.calculationEndDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                        <div className="flex justify-between text-sm">
                                                                            <span className="text-muted-foreground">Total Days in Month:</span>
                                                                            <span className="font-medium">{payroll.daysInMonth || 30} Days</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm">
                                                                            <span className="text-muted-foreground">Days Elapsed (Payable):</span>
                                                                            <span className="font-medium text-blue-600">{payroll.payableDays || payroll.totalDays} Days</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm">
                                                                            <span className="text-muted-foreground">Off Days Passed (Paid):</span>
                                                                            <span className="font-medium">{payroll.offDays || 0} Days</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm font-medium border-t pt-2 mt-2">
                                                                            <span>Pro-Rated Base Salary:</span>
                                                                            <span>{formatCurrency((payroll.salary / (payroll.daysInMonth || 30)) * (payroll.payableDays || payroll.totalDays))}</span>
                                                                        </div>
                                                                        <p className="text-[10px] text-muted-foreground mt-1">
                                                                            *Salary is calculated up to the date generated, dividing monthly fixed salary by exact calendar days.
                                                                        </p>
                                                                    </div>
                                                                </div>

                                                                {/* Summary */}
                                                                <div className="space-y-3 bg-white p-4 rounded-md shadow-sm border border-border/50 overflow-hidden flex flex-col">
                                                                    <h4 className="font-semibold text-sm border-b pb-2">Working Summary</h4>
                                                                    <div className="space-y-1">
                                                                        <div className="flex justify-between text-sm">
                                                                            <span className="text-muted-foreground">Days Present:</span>
                                                                            <span className="font-medium">{payroll.presentDays} Days</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm">
                                                                            <span className="text-muted-foreground">Days Absent:</span>
                                                                            <span className="font-medium text-rose-500">{payroll.totalAbsents} Days</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm">
                                                                            <span className="text-muted-foreground">Short Hours:</span>
                                                                            <span className="font-medium text-rose-500">
                                                                                {Math.floor((payroll.shortHours?.minutes || 0) / 60)}h {(payroll.shortHours?.minutes || 0) % 60}m
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm">
                                                                            <span className="text-muted-foreground">Overtime:</span>
                                                                            <span className="font-medium text-emerald-500">
                                                                                {Math.floor((payroll.overtime?.minutes || 0) / 60)}h {(payroll.overtime?.minutes || 0) % 60}m
                                                                            </span>
                                                                        </div>
                                                                    </div>

                                                                    {payroll.dailyBreakdown && payroll.dailyBreakdown.length > 0 && (
                                                                        <div className="mt-4 pt-4 border-t border-slate-100 flex-1">
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                onClick={() => setShowDailyBreakdownId(showDailyBreakdownId === payroll._id ? null : payroll._id)}
                                                                                className="w-full text-[10px] font-black text-blue-600 hover:text-blue-700 hover:bg-blue-50 uppercase tracking-widest h-8 mb-2 border border-blue-100/50"
                                                                            >
                                                                                {showDailyBreakdownId === payroll._id ? 'Hide Detailed Audit' : 'View Detailed Breakdown'}
                                                                                {showDailyBreakdownId === payroll._id ? <ChevronUp className="ml-2 h-3 w-3" /> : <ChevronDown className="ml-2 h-3 w-3" />}
                                                                            </Button>

                                                                            {showDailyBreakdownId === payroll._id && (
                                                                                <div className="max-h-[180px] overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/50 animate-in fade-in slide-in-from-top-1">
                                                                                    <table className="w-full text-left border-collapse">
                                                                                        <thead className="sticky top-0 bg-white shadow-sm z-10">
                                                                                            <tr>
                                                                                                <th className="p-1.5 text-[9px] font-bold text-slate-400 uppercase">Date</th>
                                                                                                <th className="p-1.5 text-[9px] font-bold text-slate-400 uppercase">Work</th>
                                                                                                <th className="p-1.5 text-[9px] font-bold text-slate-400 uppercase text-right">Earned</th>
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody>
                                                                                            {payroll.dailyBreakdown.map((day, idx) => (
                                                                                                <tr key={idx} className="border-t border-slate-100 hover:bg-white transition-colors">
                                                                                                    <td className="p-1.5 text-[10px] font-medium text-slate-600">
                                                                                                        {new Date(day.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                                                                                        <span className={`ml-1 text-[8px] px-1 rounded-full ${
                                                                                                            day.status.includes('Absent') || day.status.includes('Missed') ? 'bg-rose-100 text-rose-500' : 
                                                                                                            day.status.includes('Off') ? 'bg-slate-200 text-slate-500' : 
                                                                                                            'bg-emerald-100 text-emerald-500'
                                                                                                        }`}>
                                                                                                            {day.status}
                                                                                                        </span>
                                                                                                    </td>
                                                                                                    <td className="p-1.5 text-[10px] font-bold text-slate-700">
                                                                                                        {day.workMinutes > 0 ? `${Math.floor(day.workMinutes / 60)}h` : '0h'}
                                                                                                    </td>
                                                                                                    <td className="p-1.5 text-[10px] font-black text-slate-900 text-right">
                                                                                                        {formatCurrency(day.earnedSalary)}
                                                                                                    </td>
                                                                                                </tr>
                                                                                            ))}
                                                                                        </tbody>
                                                                                        <tfoot className="sticky bottom-0 bg-slate-100/80 backdrop-blur-sm border-t-2 border-slate-200">
                                                                                            <tr>
                                                                                                <th className="p-1.5 text-[9px] font-black text-slate-700 uppercase">TOTAL</th>
                                                                                                <th className="p-1.5 text-[10px] font-black text-slate-900">
                                                                                                    {Math.floor(payroll.dailyBreakdown.reduce((acc, curr) => acc + (curr.workMinutes || 0), 0) / 60)}h{' '}
                                                                                                    {payroll.dailyBreakdown.reduce((acc, curr) => acc + (curr.workMinutes || 0), 0) % 60}m
                                                                                                </th>
                                                                                                <th className="p-1.5 text-[10px] font-black text-emerald-700 text-right">
                                                                                                    {formatCurrency(payroll.dailyBreakdown.reduce((acc, curr) => acc + (curr.earnedSalary || 0), 0))}
                                                                                                </th>
                                                                                            </tr>
                                                                                        </tfoot>
                                                                                    </table>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {/* Financials */}
                                                                <div className="space-y-3 bg-white p-4 rounded-md shadow-sm border border-border/50">
                                                                    <h4 className="font-semibold text-sm border-b pb-2 flex items-center gap-2">
                                                                        <DollarSign className="h-4 w-4 text-emerald-500" />
                                                                        Financial Breakdown
                                                                    </h4>
                                                                    <div className="space-y-1">
                                                                        <div className="flex justify-between text-sm text-emerald-600">
                                                                            <span>Overtime Earned:</span>
                                                                            <span>+{formatCurrency(payroll.overtime?.pay || 0)}</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm text-rose-500">
                                                                            <span>Absent Penalty:</span>
                                                                            <span>-{formatCurrency(payroll.deductions?.absentDeduction || 0)}</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm text-rose-500">
                                                                            <span>Late Penalty:</span>
                                                                            <span>-{formatCurrency(payroll.deductions?.lateDeduction || 0)}</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm text-rose-500">
                                                                            <span>Short Hours Penalty:</span>
                                                                            <span>-{formatCurrency(payroll.shortHours?.pay || 0)}</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm font-bold border-t pt-2 mt-2">
                                                                            <span>Final Net Salary:</span>
                                                                            <span className="text-emerald-600">{formatCurrency(payroll.netSalary)}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
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

export default PayrollManagement;

