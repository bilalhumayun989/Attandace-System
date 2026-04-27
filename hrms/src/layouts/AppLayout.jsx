import { API_BASE_URL } from '../config';
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Clock, Calendar, User, LogOut, Bell, Briefcase, Menu, X, ChevronDown, ChevronUp, History } from 'lucide-react';
import { Button } from '../components/ui/Button';

const AppLayout = () => {
    const navigate = useNavigate();
    const { employeeUser: user, logout } = useAuth();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const handleLogout = () => {
        logout('Employee');
        navigate('/login');
    };

    const navItems = [
        { icon: Clock, label: 'Dashboard', path: '/employee/dashboard' },
        { icon: History, label: 'My Attendance', path: '/employee/attendance' },
        { icon: User, label: 'Profile', path: '/employee/profile' },
    ];

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
                                A
                            </div>
                            <span className="font-bold text-xl tracking-tight text-foreground">Attendance Mgr</span>
                        </div>
                        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setIsSidebarOpen(false)}>
                            <X size={20} />
                        </Button>
                    </div>

                    <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                        {navItems.map((item) => (
                            <NavLink
                                key={item.path}
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
                        <div className="flex items-center gap-3 mb-4 px-2">
                            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-secondary to-muted p-[1px]">
                                <div className="h-full w-full rounded-full bg-card overflow-hidden">
                                    <img src={`https://ui-avatars.com/api/?name=${user?.name || 'User'}&background=random`} alt="User" className="h-full w-full object-cover" />
                                </div>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-bold text-foreground">{user?.name || 'Employee'}</span>
                                <span className="text-xs text-muted-foreground">{user?.employeeId || 'Staff'}</span>
                            </div>
                        </div>
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
                    {/* Topbar (Mobile Trigger only) */}
                    <header className="h-16 border-b border-border bg-background/50 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 sticky top-0 z-10 w-full lg:hidden">
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(true)}>
                                <Menu size={20} />
                            </Button>
                            <span className="font-bold text-lg">Attendance Manager</span>
                        </div>
                        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground rounded-full">
                            <Bell size={20} />
                            <span className="absolute top-2 right-2.5 h-2 w-2 bg-destructive rounded-full" />
                        </Button>
                    </header>

                    <header className="hidden lg:flex h-16 border-b border-border bg-background/50 backdrop-blur-md items-center justify-end px-6 sticky top-0 z-10 w-full">
                        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground rounded-full">
                            <Bell size={20} />
                            <span className="absolute top-2 right-2.5 h-2 w-2 bg-destructive rounded-full" />
                        </Button>
                    </header>

                    <main className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth">
                        <Outlet />
                    </main>
                </div>
            </div>
        </div>
    );
};

export default AppLayout;
