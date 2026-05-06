import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogOut, User } from 'lucide-react';
import { Button } from '../components/ui/Button';

const EmployeeLayout = () => {
    return (
        <div className="min-h-screen bg-black overflow-hidden">
            <main className="h-screen w-screen overflow-hidden">
                <Outlet />
            </main>
        </div>
    );
};

export default EmployeeLayout;
