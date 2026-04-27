import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Bell, Lock, User, Shield, Globe } from 'lucide-react';

const Settings = () => {
    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Settings</h1>
                <p className="text-muted-foreground mt-1 font-medium">Manage your account settings and preferences.</p>
            </div>

            <div className="grid gap-6">
                <Card className="border shadow-sm bg-card">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <User className="h-5 w-5 text-primary" />
                            <CardTitle>Profile Information</CardTitle>
                        </div>
                        <CardDescription>Update your account details and profile.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">First Name</label>
                                <Input defaultValue="Admin" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Last Name</label>
                                <Input defaultValue="User" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Email Address</label>
                                <Input defaultValue="admin@brostech.com" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Role</label>
                                <Input defaultValue="HR Manager" disabled className="bg-muted" />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button>Save Changes</Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border shadow-sm bg-card">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Bell className="h-5 w-5 text-primary" />
                            <CardTitle>Notifications</CardTitle>
                        </div>
                        <CardDescription>Configure how you receive alerts.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                            <div className="space-y-0.5">
                                <h4 className="text-sm font-medium">Email Notifications</h4>
                                <p className="text-xs text-muted-foreground">Receive daily summaries and alerts.</p>
                            </div>
                            <Badge variant="success">Enabled</Badge>
                        </div>
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                            <div className="space-y-0.5">
                                <h4 className="text-sm font-medium">Push Notifications</h4>
                                <p className="text-xs text-muted-foreground">Receive real-time updates in browser.</p>
                            </div>
                            <Badge variant="secondary">Disabled</Badge>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border shadow-sm bg-card">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-primary" />
                            <CardTitle>Security</CardTitle>
                        </div>
                        <CardDescription>Manage your password and security sessions.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <h4 className="text-sm font-medium">Two-Factor Authentication</h4>
                                <p className="text-xs text-muted-foreground">Add an extra layer of security.</p>
                            </div>
                            <Button variant="outline" size="sm">Enable 2FA</Button>
                        </div>
                        <div className="pt-4 border-t">
                            <Button variant="destructive" size="sm">Change Password</Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default Settings;
