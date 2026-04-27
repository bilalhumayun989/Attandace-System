import { API_BASE_URL } from '../../config';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Mail, User, Lock, Save, Loader2, Building } from 'lucide-react';

const AdminSettings = () => {
    const { adminUser: user, checkAuth } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        department: '', // Used as Company Name for Admin
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });

    useEffect(() => {
        if (user) {
            setFormData(prev => ({
                ...prev,
                name: user.name || '',
                email: user.email || '',
                department: user.department || '',
            }));
        }
    }, [user]);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
            alert("New passwords don't match!");
            return;
        }

        if (formData.newPassword && !formData.currentPassword) {
            alert("Please enter your current password to change it.");
            return;
        }

        setIsLoading(true);
        try {
            const updateData = {
                name: formData.name,
                email: formData.email,
                department: formData.department
            };

            if (formData.newPassword) {
                updateData.newPassword = formData.newPassword;
                updateData.currentPassword = formData.currentPassword;
            }

            const response = await fetch(``, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(updateData)
            });

            if (response.ok) {
                const updatedUser = await response.json();
                alert('Settings updated successfully!');
                setFormData(prev => ({
                    ...prev,
                    currentPassword: '',
                    newPassword: '',
                    confirmPassword: ''
                }));
                // Optionally refresh user context if exposed
            } else {
                const errorData = await response.json();
                alert(`Failed to update settings: ${errorData.message}`);
            }
        } catch (error) {
            console.error('Error updating settings:', error);
            alert('An error occurred while updating settings.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!user) return <div className="p-10 font-medium text-center">Loading settings...</div>;

    const initials = user.name?.split(' ').map(n => n[0]).join('') || 'A';

    return (
        <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl">
            <div className="flex flex-col md:flex-row gap-6 items-center bg-card p-6 rounded-xl border shadow-sm">
                <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center text-primary text-3xl font-bold uppercase shrink-0">
                    {initials}
                </div>
                <div className="text-center md:text-left">
                    <h1 className="text-2xl font-bold">{user.name}</h1>
                    <p className="text-muted-foreground">{user.email}</p>
                    <div className="mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        Administrator
                    </div>
                </div>
            </div>

            <div className="grid gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Account Settings</CardTitle>
                        <CardDescription>Manage your profile information and security.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                        <User size={16} /> Full Name
                                    </label>
                                    <Input
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        placeholder="Admin Name"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                        <Mail size={16} /> Email Address
                                    </label>
                                    <Input
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        placeholder="admin@example.com"
                                    />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                        <Building size={16} /> Company / Department Name
                                    </label>
                                    <Input
                                        name="department"
                                        value={formData.department}
                                        onChange={handleChange}
                                        placeholder="Company Name"
                                    />
                                </div>
                            </div>

                            <div className="pt-6 border-t">
                                <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                                    <Lock size={18} /> Security
                                </h3>
                                <div className="space-y-4 max-w-2xl">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Current Password</label>
                                        <Input
                                            type="password"
                                            name="currentPassword"
                                            value={formData.currentPassword}
                                            onChange={handleChange}
                                            placeholder="Enter current password to change"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">New Password</label>
                                            <Input
                                                type="password"
                                                name="newPassword"
                                                value={formData.newPassword}
                                                onChange={handleChange}
                                                placeholder="Min. 6 characters"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Confirm New Password</label>
                                            <Input
                                                type="password"
                                                name="confirmPassword"
                                                value={formData.confirmPassword}
                                                onChange={handleChange}
                                                placeholder="Re-enter new password"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end pt-4">
                                <Button type="submit" disabled={isLoading} className="w-full md:w-auto">
                                    {isLoading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
                                    Save Changes
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default AdminSettings;

