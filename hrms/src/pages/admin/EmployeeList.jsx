import { API_BASE_URL } from '../../config';
import React, { useState, useEffect } from 'react';
import { Plus, Search, Mail, Phone, Calendar, Edit2, Trash2, Camera } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { usePermissions } from '../../context/PermissionsContext';

const EmployeeList = () => {
    const navigate = useNavigate();
    const { can } = usePermissions();
    const { adminUser } = useAuth();
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
        firstName: '',
        lastName: '',
        department: '',
        role: '',
        salary: '',
    });

    const [employees, setEmployees] = useState([]);
    // Dedicated offDay state — isolated from formData to prevent re-render conflicts
    const [selectedOffDay, setSelectedOffDay] = useState(5);

    useEffect(() => {
        fetchEmployees();
    }, []);

    const fetchEmployees = async () => {
        try {
            const roleHeader = adminUser?.role || 'Admin';
            const response = await fetch(`${API_BASE_URL}/users`, {
                headers: { 'X-Role-Context': roleHeader },
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
        const empOffDay = Array.isArray(employee.offDays) && employee.offDays.length > 0 ? Number(employee.offDays[0]) : 5;
        setSelectedOffDay(empOffDay);
        setFormData({
            firstName,
            lastName: lastNameParts.join(' '),
            department: employee.department,
            role: employee.role,
            salary: employee.salary || '',
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
                    name: `${formData.firstName} ${formData.lastName}`,
                    department: formData.department,
                    role: formData.role,
                    salary: Number(formData.salary) || 0,
                    offDays: [selectedOffDay],
                }),

            });

            const data = await response.json();

            if (response.ok) {
                setMessage({ type: 'success', text: 'Employee created successfully!' });
                fetchEmployees();
                setTimeout(() => {
                    setIsAddModalOpen(false);
                    resetForm();
                    navigate('/admin/employees');
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
                    department: formData.department,
                    role: formData.role,
                    salary: Number(formData.salary) || 0,
                    offDays: [selectedOffDay],
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
                setMessage({ type: 'success', text: 'Employee deleted successfully!' });
                fetchEmployees();
                setTimeout(() => {
                    setIsEditModalOpen(false);
                    resetForm();
                }, 2000);
            } else {
                alert('Failed to delete employee');
            }
        } catch (error) {
            console.error('Error deleting employee:', error);
        }
    };

    const handleDeleteUserFace = async (id) => {
        if (!window.confirm("Are you sure you want to delete this employee's face data?")) return;

        try {
            const response = await fetch(`${API_BASE_URL}/attendance/enroll-face/${id}`, {
                method: 'DELETE',
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });

            if (response.ok) {
                setMessage({ type: 'success', text: 'Face data deleted successfully!' });
                fetchEmployees();
                setTimeout(() => {
                    setIsEditModalOpen(false);
                    resetForm();
                }, 2000);
            } else {
                const data = await response.json();
                setMessage({ type: 'error', text: data.message || 'Failed to delete face data' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Error connecting to server' });
        }
    };

    const resetForm = () => {
        setFormData({
            firstName: '',
            lastName: '',
            department: '',
            role: '',
            salary: '',
        });
        setSelectedOffDay(5);
        setEditingEmployee(null);
        setMessage({ type: '', text: '' });
    };

    const filteredEmployees = employees.filter(
        (emp) => emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (emp.employeeId && emp.employeeId.toLowerCase().includes(searchTerm.toLowerCase())) ||
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
                                    <th className="h-10 px-4 py-3 align-middle hidden lg:table-cell">Off Day</th>
                                    <th className="h-10 px-4 py-3 align-middle">Status</th>
                                    <th className="h-10 px-4 py-3 align-middle hidden sm:table-cell">Face Status</th>
                                    <th className="h-10 px-4 py-3 align-middle text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40 bg-card">
                                {filteredEmployees.map((employee) => (
                                    <tr key={employee._id} className={`hover:bg-muted/30 transition-colors ${employee.status === 'Deleted' ? 'line-through opacity-50 bg-muted/20' : ''}`}>
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
                                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Array.isArray(employee.offDays) && employee.offDays.length > 0 && typeof employee.offDays[0] === 'number' ? employee.offDays[0] : 5] || 'Fri'} (Off)
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
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary disabled:opacity-50" disabled={employee.status === 'Deleted'} onClick={() => handleEditClick(employee)}>
                                                        <Edit2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                {can('employees', 'delete') && (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive disabled:opacity-50" disabled={employee.status === 'Deleted'} onClick={() => handleDeleteEmployee(employee._id)}>
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

                    {/* Employee ID is auto-generated — show read-only in edit mode */}
                    {isEditModalOpen && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-foreground/80">Employee ID</label>
                            <Input value={editingEmployee?.employeeId || ''} disabled className="bg-muted/30 border-muted-foreground/20 opacity-60" />
                            <p className="text-xs text-muted-foreground">Auto-assigned. Cannot be changed.</p>
                        </div>
                    )}

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
                            <label className="text-sm font-bold text-foreground/80">Monthly Salary (Rs)</label>
                            <Input
                                name="salary"
                                type="number"
                                value={formData.salary}
                                onChange={handleInputChange}
                                placeholder="e.g. 25000"
                                min="0"
                                className="bg-muted/30 border-muted-foreground/20 focus:bg-background transition-all"
                            />
                            <p className="text-xs text-muted-foreground">Base monthly salary used for payroll calculation.</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label className="text-sm font-bold text-foreground/80">Weekly Off Day</label>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { label: 'Sun', value: 0 },
                                { label: 'Mon', value: 1 },
                                { label: 'Tue', value: 2 },
                                { label: 'Wed', value: 3 },
                                { label: 'Thu', value: 4 },
                                { label: 'Fri', value: 5 },
                                { label: 'Sat', value: 6 },
                            ].map((day) => (
                                <button
                                    key={day.value}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setSelectedOffDay(day.value); }}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border ${selectedOffDay === day.value
                                            ? 'bg-primary text-primary-foreground border-primary shadow-md'
                                            : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                                        }`}
                                >
                                    {day.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">If employee works on this day, they earn 1.5× daily salary.</p>
                    </div>

                    {adminUser?.role === 'SuperAdmin' && (
                        <div className="pt-4 mt-6 border-t border-rose-200/50 space-y-4">
                            <h3 className="text-sm font-bold text-rose-600 flex items-center gap-2">
                                <Trash2 className="h-4 w-4" /> Danger Zone
                            </h3>
                            <div className="flex flex-col sm:flex-row gap-3">
                                {editingEmployee?.faceEnrolled && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                                        onClick={() => handleDeleteUserFace(editingEmployee._id)}
                                        disabled={loading}
                                    >
                                        <Camera className="h-4 w-4 mr-2" /> Delete Face Data
                                    </Button>
                                )}
                                <Button
                                    type="button"
                                    variant="destructive"
                                    className="bg-rose-600 hover:bg-rose-700"
                                    onClick={() => handleDeleteEmployee(editingEmployee._id)}
                                    disabled={loading}
                                >
                                    <Trash2 className="h-4 w-4 mr-2" /> Delete Employee Permanently
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
};

export default EmployeeList;

