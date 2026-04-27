import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../context/PermissionsContext';

const ProtectedRoute = ({ allowedRoles }) => {
    const { adminUser, employeeUser, loading } = useAuth();
    const { hasAnyAdminPermission } = usePermissions();

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
    );

    const isAuthorized = (() => {
        if (!allowedRoles) return !!(adminUser || employeeUser);

        // For admin routes: user must be logged in as Admin AND have at least one permission
        const hasAdminAccess = allowedRoles.includes('Admin') && adminUser && hasAnyAdminPermission();
        const hasEmployeeAccess = allowedRoles.includes('Employee') && employeeUser;

        return hasAdminAccess || hasEmployeeAccess;
    })();

    if (!isAuthorized) {
        return <Navigate to="/login" replace />;
    }

    return <Outlet />;
};

export default ProtectedRoute;

