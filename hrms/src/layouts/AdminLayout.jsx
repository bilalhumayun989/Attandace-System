import { API_BASE_URL } from '../config';
import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../context/PermissionsContext';
import {
    LayoutDashboard,
    Users,
    CalendarCheck,
    Wallet,
    Settings,
    LogOut,
    Bell,
    Search,
    Menu,
    X,
    ShieldCheck,
    Coffee
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

const AdminLayout = () => {
    const navigate = useNavigate();
    const { adminUser: user, logout } = useAuth();
    const { can, isOwner } = usePermissions();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const handleLogout = () => {
        logout('Admin');
        navigate('/login');
    };

    const navItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/admin/dashboard', show: true },
        { icon: Users, label: 'Employees', path: '/admin/employees', show: can('employees', 'view') },
        { icon: CalendarCheck, label: 'Attendance', path: '/admin/attendance', show: can('attendance', 'view') },
        { icon: Wallet, label: 'Payroll', path: '/admin/payroll', show: can('payroll', 'view') },
        { icon: Settings, label: 'Settings', path: '/admin/settings', show: true },
    ].filter(item => item.show);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="flex h-screen max-w-app mx-auto bg-background text-foreground overflow-hidden font-sans relative">
                {/* Mobile Sidebar Overlay */}
                {isSidebarOpen && (
                    <div
                        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
                        onClick={() => setIsSidebarOpen(false)}
                    />
                )}

                {/* Sidebar */}
                <aside
                    className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card transition-transform duration-300 lg:static lg:translate-x-0 flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                        }`}
                >
                    <div className="p-6 flex items-center justify-between border-b border-border/40">
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center font-bold text-primary-foreground shadow-lg shadow-primary/20">
                                H
                            </div>
                            <span className="font-bold text-xl tracking-tight text-foreground">Attendance Manager</span>
                        </div>
                        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setIsSidebarOpen(false)}>
                            <X size={20} />
                        </Button>
                    </div>

                    <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                        {navItems.map((item) => (
                            <NavLink
                                key={item.label}
                                to={item.path}
                                onClick={() => setIsSidebarOpen(false)}
                                className={({ isActive }) =>
                                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group ${isActive
                                        ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                    }`
                                }
                            >
                                <item.icon size={18} />
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>

                    <div className="p-4 border-t border-border/40">
                        <Button
                            variant="ghost"
                            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={handleLogout}
                        >
                            <LogOut size={18} className="mr-2" />
                            Logout
                        </Button>
                    </div>
                </aside>

                {/* Main Content */}
                <div className="flex-1 flex flex-col h-full overflow-hidden relative">
                    {/* Decorative Background for Main Content */}
                    <div className="absolute top-0 left-0 w-full h-full pointer-events-none -z-10 opacity-30">
                        <div className="absolute top-[10%] right-[10%] w-[30%] h-[30%] bg-primary/5 blur-[120px] rounded-full" />
                        <div className="absolute bottom-[10%] left-[10%] w-[20%] h-[20%] bg-accent/5 blur-[100px] rounded-full" />
                    </div>

                    {/* Topbar */}
                    <header className="h-16 border-b border-border bg-background/50 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 sticky top-0 z-10 w-full">
                        <div className="w-full flex items-center justify-between">
                            <div className="flex items-center gap-4 w-1/2 sm:w-1/3">
                                <Button variant="ghost" size="icon" className="lg:hidden -ml-2" onClick={() => setIsSidebarOpen(true)}>
                                    <Menu size={20} />
                                </Button>
                                <div className="relative w-full max-w-sm hidden sm:block">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search everything..."
                                        className="pl-10 bg-muted/50 border-transparent focus:bg-background focus:border-input h-10 rounded-xl text-foreground placeholder:text-muted-foreground transition-all"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground rounded-full">
                                    <Bell size={20} />
                                    <span className="absolute top-2 right-2.5 h-2 w-2 bg-destructive rounded-full" />
                                </Button>
                                <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-primary to-accent p-[2px]">
                                    <div className="h-full w-full rounded-full bg-card overflow-hidden">
                                        <img src={`https://ui-avatars.com/api/?name=${user?.name || 'Admin'}&background=random`} alt="Admin" className="h-full w-full object-cover" />
                                    </div>
                                </div>
                                <div className="hidden md:block">
                                    <p className="text-sm font-bold leading-none text-foreground">{user?.name || 'Admin User'}</p>
                                    <p className="text-xs text-muted-foreground font-medium">{user?.role || 'Administrator'}</p>
                                </div>
                            </div>
                        </div>
                    </header>

                    {/* Page Content */}
                    <main className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth">
                        <Outlet />
                    </main>
                </div>
            </div>
        </div>
    );
};

export default AdminLayout;
