import { API_BASE_URL } from '../../config';
import React, { useState, useEffect } from 'react';
import { Plus, Search, Mail, Phone, Calendar, Edit2, Trash2, Camera } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { usePermissions } from '../../context/PermissionsContext';

const EmployeeList = () => {
    const navigate = useNavigate();
    const { can } = usePermissions();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [editingEmployee, setEditingEmployee] = useState(null);

    const format12h = (time24) => {
        if (!time24) return '';
        const [hours, minutes] = time24.split(':');
        const h = parseInt(hours);
        const m = minutes;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${m} ${ampm}`;
    };

    const [formData, setFormData] = useState({
        employeeId: '',
        firstName: '',
        lastName: '',

        email: '',
        password: '',
        department: '',
        role: '',
        salary: '',
        extraHourlyRate: '',
        workingHours: {
            start: '09:00',
            end: '18:00'
        },
        isOvertimeAllowed: false
    });

    const [employees, setEmployees] = useState([]);

    useEffect(() => {
        fetchEmployees();
    }, []);

    const fetchEmployees = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/users`, {
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
                setEmployees(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error('Error fetching employees:', error);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleEditClick = (employee) => {
        setEditingEmployee(employee);
        const [firstName, ...lastNameParts] = employee.name.split(' ');
        setFormData({
            employeeId: employee.employeeId || '',
            firstName,
            lastName: lastNameParts.join(' '),
            email: employee.email,
            password: '', // Don't pre-fill password
            department: employee.department,
            role: employee.role,
            salary: employee.salary || '',
            extraHourlyRate: employee.extraHourlyRate || '',
            isOvertimeAllowed: employee.isOvertimeAllowed || false,
            workingHours: employee.workingHours || { start: '09:00', end: '18:00' }
        });
        setIsEditModalOpen(true);
    };


    const handleCreateEmployee = async () => {
        setLoading(true);
        setMessage({ type: '', text: '' });

        try {
            const response = await fetch(`${API_BASE_URL}/users/add`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Role-Context': 'Admin'
                },
                credentials: 'include',
                body: JSON.stringify({
                    employeeId: formData.employeeId,
                    name: `${formData.firstName} ${formData.lastName}`,
                    email: formData.email,
                    password: formData.password,
                    department: formData.department,
                    role: formData.role,
                    workingHours: formData.workingHours,
                    salary: Number(formData.salary),
                    extraHourlyRate: Number(formData.extraHourlyRate),
                    isOvertimeAllowed: formData.isOvertimeAllowed
                }),

            });

            const data = await response.json();

            if (response.ok) {
                setMessage({ type: 'success', text: 'Employee created! Redirecting to Face Enrollment...' });
                fetchEmployees();
                setTimeout(() => {
                    setIsAddModalOpen(false);
                    resetForm();
                    navigate(`/admin/enroll-face?userId=${data._id}`);
                }, 1500);
            } else {
                setMessage({ type: 'error', text: data.message || 'Failed to create employee' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Error connecting to server' });
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateEmployee = async () => {
        setLoading(true);
        setMessage({ type: '', text: '' });

        try {
            const response = await fetch(`${API_BASE_URL}/users/${editingEmployee._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Role-Context': 'Admin'
                },
                credentials: 'include',
                body: JSON.stringify({
                    name: `${formData.firstName} ${formData.lastName}`,
                    email: formData.email,
                    password: formData.password || undefined,
                    department: formData.department,
                    role: formData.role,
                    workingHours: formData.workingHours,
                    salary: Number(formData.salary),
                    extraHourlyRate: Number(formData.extraHourlyRate),
                    isOvertimeAllowed: formData.isOvertimeAllowed
                }),
            });

            if (response.ok) {
                setMessage({ type: 'success', text: 'Employee updated successfully!' });
                fetchEmployees();
                setTimeout(() => {
                    setIsEditModalOpen(false);
                    resetForm();
                }, 2000);
            } else {
                const data = await response.json();
                setMessage({ type: 'error', text: data.message || 'Failed to update employee' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Error connecting to server' });
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteEmployee = async (id) => {
        if (!window.confirm('Are you sure you want to delete this employee?')) return;

        try {
            const response = await fetch(`${API_BASE_URL}/users/${id}`, {
                method: 'DELETE',
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });

            if (response.ok) {
                fetchEmployees();
            } else {
                alert('Failed to delete employee');
            }
        } catch (error) {
            console.error('Error deleting employee:', error);
        }
    };

    const resetForm = () => {
        setFormData({
            employeeId: '',
            firstName: '',
            lastName: '',

            email: '',
            password: '',
            department: '',
            role: '',
            salary: '',
            extraHourlyRate: '',
            isOvertimeAllowed: false,
            workingHours: { start: '09:00', end: '18:00' }
        });
        setEditingEmployee(null);
        setMessage({ type: '', text: '' });
    };

    const filteredEmployees = employees.filter(
        (emp) => emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (emp.employeeId && emp.employeeId.toLowerCase().includes(searchTerm.toLowerCase())) ||
            emp.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            emp.role.toLowerCase().includes(searchTerm.toLowerCase())
    );


    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* ... (Header and Table remains mostly same, maybe add Salary column if needed, but let's stick to modal first) */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Employees</h2>
                    <p className="text-muted-foreground">Manage your team members and their roles.</p>
                </div>
                {can('employees', 'edit') && (
                    <Button onClick={() => { resetForm(); setIsAddModalOpen(true); }} className="w-full sm:w-auto shadow-lg shadow-primary/20">
                        <Plus className="mr-2 h-4 w-4" /> Add Employee
                    </Button>
                )}
            </div>

            <Card className="border-muted/40 shadow-sm">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle>All Staff</CardTitle>
                        <div className="relative w-full max-w-sm">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search employees..."
                                className="pl-9 h-9"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border border-muted/40 overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground font-medium">
                                <tr>
                                    <th className="h-10 px-4 py-3 align-middle">Name</th>
                                    <th className="h-10 px-4 py-3 align-middle hidden sm:table-cell">Role</th>
                                    <th className="h-10 px-4 py-3 align-middle hidden md:table-cell">Department</th>
                                    <th className="h-10 px-4 py-3 align-middle hidden lg:table-cell">Shift</th>
                                    <th className="h-10 px-4 py-3 align-middle">Status</th>
                                    <th className="h-10 px-4 py-3 align-middle hidden sm:table-cell">Face Status</th>
                                    <th className="h-10 px-4 py-3 align-middle text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40 bg-card">
                                {filteredEmployees.map((employee) => (
                                    <tr key={employee._id} className="hover:bg-muted/30 transition-colors">
                                        <td className="p-4 align-middle">
                                            <div className="flex items-center gap-3">
                                                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs ring-2 ring-background">
                                                    {employee.name?.split(' ').map(n => n[0]).join('') || '?'}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-semibold">{employee.name || 'Unknown'}</span>
                                                    <span className="text-xs text-muted-foreground">{employee.employeeId || 'No ID'}</span>
                                                </div>

                                            </div>
                                        </td>
                                        <td className="p-4 align-middle hidden sm:table-cell">{employee.role}</td>
                                        <td className="p-4 align-middle hidden md:table-cell">
                                            <Badge variant="secondary" className="rounded-md px-2 font-normal">
                                                {employee.department}
                                            </Badge>
                                        </td>
                                        <td className="p-4 align-middle hidden lg:table-cell whitespace-nowrap">
                                            {employee.workingHours ? `${format12h(employee.workingHours.start)} - ${format12h(employee.workingHours.end)}` : 'N/A'}
                                        </td>
                                        <td className="p-4 align-middle">
                                            <Badge variant={employee.status === 'Active' ? 'success' : 'warning'}>
                                                {employee.status || 'Active'}
                                            </Badge>
                                        </td>
                                        <td className="p-4 align-middle hidden sm:table-cell">
                                            {employee.faceEnrolled ? (
                                                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Enrolled</Badge>
                                            ) : (
                                                <Badge className="bg-rose-100 text-rose-800 border-rose-200">Not Enrolled</Badge>
                                            )}
                                        </td>
                                        <td className="p-4 align-middle text-right">
                                            <div className="flex justify-end gap-2">
                                                {can('employees', 'edit') && (
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-8 w-8 text-emerald-600" 
                                                        title="Enroll Face"
                                                        onClick={() => navigate(`/admin/enroll-face?userId=${employee._id}`)}
                                                    >
                                                        <Camera className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                {can('employees', 'edit') && (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => handleEditClick(employee)}>
                                                        <Edit2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                {can('employees', 'delete') && (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteEmployee(employee._id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Add/Edit Modal */}
            <Modal
                isOpen={isAddModalOpen || isEditModalOpen}
                onClose={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); resetForm(); }}
                title={isEditModalOpen ? "Edit Employee" : "Add New Employee"}
                footer={
                    <>
                        <Button variant="ghost" onClick={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); resetForm(); }} disabled={loading}>Cancel</Button>
                        <Button onClick={isEditModalOpen ? handleUpdateEmployee : handleCreateEmployee} disabled={loading}>
                            {loading ? (isEditModalOpen ? 'Updating...' : 'Creating...') : (isEditModalOpen ? 'Save Changes' : 'Create Employee')}
                        </Button>
                    </>
                }
            >
                <div className="space-y-6">
                    {message.text && (
                        <div className={`p-4 rounded-xl text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                            {message.text}
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-bold text-foreground/80">Employee ID</label>
                        <Input name="employeeId" value={formData.employeeId} onChange={handleInputChange} placeholder="EMP-001" disabled={isEditModalOpen} className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground/80">First Name</label>
                            <Input name="firstName" value={formData.firstName} onChange={handleInputChange} placeholder="John" className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground/80">Last Name</label>
                            <Input name="lastName" value={formData.lastName} onChange={handleInputChange} placeholder="Doe" className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground/80">Email Address</label>
                            <Input name="email" type="email" value={formData.email} onChange={handleInputChange} placeholder="john@company.com" className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground/80">Password {isEditModalOpen && <span className="text-[10px] text-muted-foreground">(Optional)</span>}</label>
                            <Input name="password" type="password" value={formData.password} onChange={handleInputChange} placeholder="••••••••" className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground/80">Department</label>
                            <Input name="department" value={formData.department} onChange={handleInputChange} placeholder="Engineering" className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground/80">Role / Title</label>
                            <Input name="role" value={formData.role} onChange={handleInputChange} placeholder="Developer" className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground/80">Monthly Salary (PKR)</label>
                            <Input name="salary" type="number" value={formData.salary} onChange={handleInputChange} placeholder="50000" className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-foreground/80">Shift Start</label>
                                <Input
                                    type="time"
                                    value={formData.workingHours.start}
                                    onChange={(e) => setFormData(prev => ({ ...prev, workingHours: { ...prev.workingHours, start: e.target.value } }))}
                                    className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-foreground/80">Shift End</label>
                                <Input
                                    type="time"
                                    value={formData.workingHours.end}
                                    onChange={(e) => setFormData(prev => ({ ...prev, workingHours: { ...prev.workingHours, end: e.target.value } }))}
                                    className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground/80">Overtime Rate (PKR/hr)</label>
                            <Input name="extraHourlyRate" type="number" value={formData.extraHourlyRate} onChange={handleInputChange} placeholder="500" className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all" />
                        </div>
                        <div className="space-y-2 flex flex-col justify-end">
                            <label className="flex items-center gap-3 cursor-pointer p-2 border border-muted/40 rounded-lg hover:bg-muted/10 transition-colors h-10">
                                <input 
                                    type="checkbox" 
                                    className="w-4 h-4 text-primary rounded border-muted-foreground/30"
                                    checked={formData.isOvertimeAllowed}
                                    onChange={(e) => setFormData(prev => ({ ...prev, isOvertimeAllowed: e.target.checked }))}
                                />
                                <span className="text-sm font-bold text-foreground/80">Allow Overtime Tracking</span>
                            </label>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default EmployeeList;

