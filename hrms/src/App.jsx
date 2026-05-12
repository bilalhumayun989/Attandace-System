import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import VerifyEmail from './pages/auth/VerifyEmail';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';

import AdminLayout from './layouts/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import EmployeeList from './pages/admin/EmployeeList';
import AttendanceTracker from './pages/admin/AttendanceTracker';
import PayrollManagement from './pages/admin/PayrollManagement';
import LeaveManagement from './pages/admin/LeaveManagement';


import AdminSettings from './pages/admin/AdminSettings';


import AppLayout from './layouts/AppLayout';
import EmployeeLayout from './layouts/EmployeeLayout';
import UserDashboard from './pages/employee/UserDashboard';
import MyAttendance from './pages/employee/MyAttendance';
import Profile from './pages/employee/Profile';

import FaceKiosk from './pages/FaceKiosk';
import FaceEnrollment from './pages/FaceEnrollment';



import { AuthProvider } from './context/AuthContext';
import { PermissionsProvider } from './context/PermissionsContext';
import ProtectedRoute from './components/ProtectedRoute';
import AccessDenied from './components/AccessDenied';
import { usePermissions } from './context/PermissionsContext';

/**
 * Renders `children` if the user has the required permission,
 * otherwise shows an AccessDenied page..
 */
const PermissionRoute = ({ module, action, children }) => {
  const { can, isOwner } = usePermissions();
  if (isOwner || can(module, action)) return children;
  return <AccessDenied message={`You need the "${module} → ${action}" permission to access this section.`} />;
};

function App() {
  return (
    <AuthProvider>
      <PermissionsProvider>
        <BrowserRouter basename="/attendance">
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email/:token" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
            <Route path="/kiosk" element={<FaceKiosk />} />

            {/* Admin Routes */}
            <Route element={<ProtectedRoute allowedRoles={['Admin']} />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="employees" element={
                  <PermissionRoute module="employees" action="view">
                    <EmployeeList />
                  </PermissionRoute>
                } />
                <Route path="attendance" element={
                  <PermissionRoute module="attendance" action="view">
                    <AttendanceTracker />
                  </PermissionRoute>
                } />

                <Route path="payroll" element={
                  <PermissionRoute module="payroll" action="view">
                    <PayrollManagement />
                  </PermissionRoute>
                } />
                <Route path="leaves" element={
                  <PermissionRoute module="leaves" action="view">
                    <LeaveManagement />
                  </PermissionRoute>
                } />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="enroll-face" element={<FaceEnrollment />} />

              </Route>
            </Route>

            {/* Employee Routes */}
            <Route element={<ProtectedRoute allowedRoles={['Employee']} />}>
              <Route path="/employee" element={<EmployeeLayout />}>
                <Route index element={<Navigate to="/employee/dashboard" replace />} />
                <Route path="dashboard" element={<UserDashboard />} />
                <Route path="attendance" element={<MyAttendance />} />



                <Route path="profile" element={<Profile />} />
              </Route>
            </Route>

            {/* Catch all - Redirect to Login for now */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      </PermissionsProvider>
    </AuthProvider>
  );
}

export default App;

