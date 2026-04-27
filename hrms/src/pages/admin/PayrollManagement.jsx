import { API_BASE_URL } from '../../config';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Loader2, DollarSign, Calendar, Download } from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';

const PayrollManagement = () => {
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [payrolls, setPayrolls] = useState([]);
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

    const handleGeneratePayroll = async () => {
        setGenerating(true);
        try {
            const response = await fetch(`${API_BASE_URL}/payroll/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Role-Context': 'Admin'
                },
                credentials: 'include',
                body: JSON.stringify({ month: selectedMonth, userId: selectedEmployeeId !== 'All' ? selectedEmployeeId : undefined })
            });

            if (response.ok) {
                // Refresh list
                fetchPayrolls();
                alert('Payroll generated successfully!');
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to generate payroll');
            }
        } catch (error) {
            console.error('Error generating payroll:', error);
            alert('Error connecting to server');
        } finally {
            setGenerating(false);
        }
    };

    const markAsPaid = async (payrollId) => {
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
            }
        } catch (error) {
            console.error('Error updating payroll status:', error);
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

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Payroll Management</h2>
                    <p className="text-muted-foreground">Manage monthly salaries and deductions.</p>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="relative">
                        <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="month"
                            className="pl-9 w-full sm:w-[180px]"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                        />
                    </div>
                    <select
                        className="h-10 w-full sm:w-48 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-primary cursor-pointer"
                        value={selectedEmployeeId}
                        onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    >
                        <option value="All">All Employees</option>
                        {employees.map(emp => (
                            <option key={emp._id} value={emp._id}>{emp.name}{emp.employeeId ? ` (${emp.employeeId})` : ''}</option>
                        ))}
                    </select>
                    {can('payroll', 'edit') && (
                        <Button onClick={handleGeneratePayroll} disabled={generating} className="shadow-lg shadow-primary/20">
                            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}
                            Generate Payroll
                        </Button>
                    )}
                </div>
            </div>

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
                        <div className="rounded-md border border-muted/40 overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-muted/50 text-muted-foreground font-medium">
                                    <tr>
                                        <th className="h-10 px-4 py-3 align-middle">Employee</th>
                                        <th className="h-10 px-4 py-3 align-middle">Department</th>
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
                                            <td colSpan="10" className="p-8 text-center text-muted-foreground">
                                                No payroll records found for this selection.
                                                <br />
                                                Click "Generate Payroll" to calculate.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredPayrolls.map((payroll) => (
                                            <tr key={payroll._id} className="hover:bg-muted/30 transition-colors">
                                                <td className="p-4 align-middle font-medium">
                                                    {payroll.userId?.name || 'Unknown'}
                                                    <div className="text-xs text-muted-foreground font-normal">{payroll.userId?.role}</div>
                                                </td>
                                                <td className="p-4 align-middle">
                                                    <Badge variant="secondary" className="font-normal">{payroll.userId?.department}</Badge>
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
                                                <td className="p-4 align-middle text-center">
                                                    <Badge variant={payroll.status === 'Paid' ? 'success' : 'outline'} className={payroll.status === 'Pending' ? 'text-amber-600 border-amber-200 bg-amber-50' : ''}>
                                                        {payroll.status}
                                                    </Badge>
                                                </td>
                                                <td className="p-4 align-middle text-right">
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

export default PayrollManagement;

