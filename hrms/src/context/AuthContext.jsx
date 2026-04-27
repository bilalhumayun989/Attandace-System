import { API_BASE_URL } from '../config';
import React, { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [adminUser, setAdminUser] = useState(null);
    const [employeeUser, setEmployeeUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = async (role) => {
        try {
            const response = await fetch(`${API_BASE_URL}/users/me?role=${role}`, {
                headers: {
                    'Accept': 'application/json',
                    'X-Role-Context': role
                },
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                if (role === 'Admin') setAdminUser(data);
                else setEmployeeUser(data);
            } else {
                if (role === 'Admin') setAdminUser(null);
                else setEmployeeUser(null);
            }
        } catch (error) {
            console.error(`Error checking ${role} auth:`, error);
        }
    };

    const initAuth = async () => {
        setLoading(true);
        // Rely solely on server-side session check
        await Promise.all([checkAuth('Admin'), checkAuth('Employee')]);
        setLoading(false);
    };

    useEffect(() => {
        initAuth();
    }, []);

    const login = (userData, contextRole) => {
        if (contextRole === 'admin' || userData.role === 'Admin') {
            setAdminUser(userData);
            setEmployeeUser(null);
        } else {
            setEmployeeUser(userData);
            setAdminUser(null);
        }
    };

    const logout = async (role) => {
        try {
            await fetch(`${API_BASE_URL}/users/logout?role=${role}`, {
                method: 'POST',
                credentials: 'include'
            });
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            if (role === 'Admin') setAdminUser(null);
            else if (role === 'Employee') setEmployeeUser(null);
            else {
                setAdminUser(null);
                setEmployeeUser(null);
            }
        }
    };

    return (
        <AuthContext.Provider value={{
            adminUser,
            employeeUser,
            login,
            logout,
            loading
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);

