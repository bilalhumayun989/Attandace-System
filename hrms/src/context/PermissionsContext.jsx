import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const PermissionsContext = createContext({});

// Default ALL permissions for Admin
const ALL_PERMISSIONS = {
    employees: { view: true, edit: true, delete: true },
    attendance: { view: true, edit: true },
    payroll: { view: true, edit: true },
    leaves: { view: true, edit: true }
};

export const PermissionsProvider = ({ children }) => {
    const { adminUser } = useAuth();
    const [permissions, setPermissions] = useState(ALL_PERMISSIONS);
    const [isOwner, setIsOwner] = useState(true);

    useEffect(() => {
        if (adminUser) {
            if (adminUser.role === 'Admin') {
                setPermissions(ALL_PERMISSIONS);
                setIsOwner(true);
            } else {
                // Regular Employee or fallback
                setPermissions(null);
                setIsOwner(false);
            }
        } else {
            setPermissions(null);
            setIsOwner(false);
        }
    }, [adminUser]);

    const can = (module, action) => {
        if (isOwner) return true;
        if (!permissions || !permissions[module]) return false;
        return !!permissions[module][action];
    };

    const hasAnyAdminPermission = () => {
        if (isOwner) return true;
        if (!permissions) return false;
        return Object.values(permissions).some(
            (modulePerms) => Object.values(modulePerms).some(Boolean)
        );
    };

    return (
        <PermissionsContext.Provider value={{ permissions, can, isOwner, hasAnyAdminPermission }}>
            {children}
        </PermissionsContext.Provider>
    );
};

export const usePermissions = () => useContext(PermissionsContext);
