const fs = require('fs');

const filesToFix = [
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/admin/ProjectDetails.jsx',
        fixes: [
            [/'http:\/\/localhost:5000\/api\/tasks'/g, '`${API_BASE_URL}/tasks`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/projects\/\$\{projectId\}'/g, 'fetch(`${API_BASE_URL}/projects/${projectId}`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/tasks\/project\/\$\{projectId\}'/g, 'fetch(`${API_BASE_URL}/tasks/project/${projectId}`'],
            [/await fetch\(`http:\/\/localhost:5000\/api\/tasks\/\$\{editingTask._id\}'/g, 'await fetch(`${API_BASE_URL}/tasks/${editingTask._id}`'],
            [/await fetch\(`http:\/\/localhost:5000\/api\/tasks\/\$\{id\}'/g, 'await fetch(`${API_BASE_URL}/tasks/${id}`'],
            [/await fetch\(`http:\/\/localhost:5000\/api\/tasks\/project\/\$\{projectId\}'/g, 'await fetch(`${API_BASE_URL}/tasks/project/${projectId}`'],
            [/await fetch\(`http:\/\/localhost:5000\/api\/tasks\/\$\{selectedTask._id\}\/comments'/g, 'await fetch(`${API_BASE_URL}/tasks/${selectedTask._id}/comments`'],
            [/await fetch\(`http:\/\/localhost:5000\/api\/tasks\/\$\{id\}'/g, 'await fetch(`${API_BASE_URL}/tasks/${id}`']
        ]
    },
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/admin/PayrollManagement.jsx',
        fixes: [
            [/fetch\(`http:\/\/localhost:5000\/api\/payroll\?month=\$\{selectedMonth\}'/g, 'fetch(`${API_BASE_URL}/payroll?month=${selectedMonth}`'],
            [/'http:\/\/localhost:5000\/api\/payroll\/generate'/g, '`${API_BASE_URL}/payroll/generate`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/payroll\/\$\{payrollId\}\/status'/g, 'fetch(`${API_BASE_URL}/payroll/${payrollId}/status`']
        ]
    },
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/admin/LeaveManagement.jsx',
        fixes: [
            [/'http:\/\/localhost:5000\/api\/leaves'/g, '`${API_BASE_URL}/leaves`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/leaves\/\$\{id\}'/g, 'fetch(`${API_BASE_URL}/leaves/${id}`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/leaves\/\$\{deleteId\}'/g, 'fetch(`${API_BASE_URL}/leaves/${deleteId}`']
        ]
    },
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/admin/EmployeeList.jsx',
        fixes: [
            [/'http:\/\/localhost:5000\/api\/users'/g, '`${API_BASE_URL}/users`'],
            [/'http:\/\/localhost:5000\/api\/users\/add'/g, '`${API_BASE_URL}/users/add`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/users\/\$\{editingEmployee._id\}'/g, 'fetch(`${API_BASE_URL}/users/${editingEmployee._id}`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/users\/\$\{id\}'/g, 'fetch(`${API_BASE_URL}/users/${id}`']
        ]
    },
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/admin/AttendanceTracker.jsx',
        fixes: [
            [/'http:\/\/localhost:5000\/api\/users'/g, '`${API_BASE_URL}/users`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/attendance\/user\/\$\{user._id\}'/g, 'fetch(`${API_BASE_URL}/attendance/user/${user._id}`'],
            [/'http:\/\/localhost:5000\/api\/attendance'/g, '`${API_BASE_URL}/attendance`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/attendance\/\$\{selectedRecord._id\}'/g, 'fetch(`${API_BASE_URL}/attendance/${selectedRecord._id}`']
        ]
    },
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/admin/AdminSettings.jsx',
        fixes: [
            [/fetch\(`http:\/\/localhost:5000\/api\/users\/\$\{user._id\}'/g, 'fetch(`${API_BASE_URL}/users/${user._id}`']
        ]
    },
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/employee/MyLeaves.jsx',
        fixes: [
            [/'http:\/\/localhost:5000\/api\/leaves\/my'/g, '`${API_BASE_URL}/leaves/my`'],
            [/'http:\/\/localhost:5000\/api\/leaves'/g, '`${API_BASE_URL}/leaves`']
        ]
    },
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/employee/MyTasks.jsx',
        fixes: [
            [/'http:\/\/localhost:5000\/api\/tasks\/my'/g, '`${API_BASE_URL}/tasks/my`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/tasks\/\$\{taskId\}'/g, 'fetch(`${API_BASE_URL}/tasks/${taskId}`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/tasks\/\$\{selectedTask._id\}\/comments'/g, 'fetch(`${API_BASE_URL}/tasks/${selectedTask._id}/comments`']
        ]
    },
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/employee/Profile.jsx',
        fixes: [
            [/'http:\/\/localhost:5000\/api\/projects'/g, '`${API_BASE_URL}/projects`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/users\/\$\{user._id\}'/g, 'fetch(`${API_BASE_URL}/users/${user._id}`']
        ]
    },
    {
        path: 'd:/Brostech/HRMS/hrms/src/pages/employee/UserDashboard.jsx',
        fixes: [
            [/'http:\/\/localhost:5000\/api\/attendance\/status'/g, '`${API_BASE_URL}/attendance/status`'],
            [/'http:\/\/localhost:5000\/api\/attendance\/stats'/g, '`${API_BASE_URL}/attendance/stats`'],
            [/fetch\(`http:\/\/localhost:5000\/api\/attendance\/\$\{endpoint\}'/g, 'fetch(`${API_BASE_URL}/attendance/${endpoint}`']
        ]
    }
];

filesToFix.forEach(file => {
    try {
        let content = fs.readFileSync(file.path, 'utf8');

        // Fix import path while we're at it (ensuring it's correct for its depth)
        const depth = file.path.replace('d:/Brostech/HRMS/hrms/src/', '').split('/').length - 1;
        const relPath = '../'.repeat(depth) + 'config';
        content = content.replace(/import { API_BASE_URL } from '.*?config';/g, `import { API_BASE_URL } from '${relPath}';`);

        // Apply specific fixes
        file.fixes.forEach(([regex, replacement]) => {
            content = content.replace(regex, replacement);
        });

        // Also catch any remains of the botched execution like fetch(``, 
        // This is tricky as we don't know the path, but we can look for markers.
        // Actually, my regex's above should cover most.
        
        fs.writeFileSync(file.path, content);
        console.log(`Fixed ${path.basename(file.path)}`);
    } catch (e) {
        console.error(`Error fixing ${file.path}:`, e);
    }
});
