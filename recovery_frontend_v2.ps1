# ProjectOverview.jsx
$file = "d:\Brostech\HRMS\hrms\src\pages\admin\ProjectOverview.jsx"
$content = Get-Content $file -Raw
$content = $content -replace "import { API_BASE_URL } from '.*?config';", "import { API_BASE_URL } from '../../config';"
$content = $content -replace "'http://localhost:5000/api/projects'", "`${API_BASE_URL}/projects`"
$content = $content -replace "'http://localhost:5000/api/users'", "`${API_BASE_URL}/users`"
$content = $content -replace "await fetch\(` ``,", "await fetch(`${API_BASE_URL}/projects/` + id,"
$content = $content -replace "isEditMode\s+?\?\s+?``\s+?:\s+?'http://localhost:5000/api/projects'", "isEditMode ? `${API_BASE_URL}/projects/` + newProject._id : `${API_BASE_URL}/projects`"
Set-Content $file $content

# ProjectDetails.jsx
$file = "d:\Brostech\HRMS\hrms\src\pages\admin\ProjectDetails.jsx"
$content = Get-Content $file -Raw
$content = $content -replace "import { API_BASE_URL } from '.*?config';", "import { API_BASE_URL } from '../../config';"
$content = $content -replace "fetch\(`http://localhost:5000/api/projects/\$\{projectId\}'", "fetch(`${API_BASE_URL}/projects/` + projectId"
$content = $content -replace "fetch\(`http://localhost:5000/api/tasks/project/\$\{projectId\}'", "fetch(`${API_BASE_URL}/tasks/project/` + projectId"
$content = $content -replace "'http://localhost:5000/api/tasks'", "`${API_BASE_URL}/tasks`"
$content = $content -replace "await fetch\(`http://localhost:5000/api/tasks/\$\{editingTask._id\}'", "await fetch(`${API_BASE_URL}/tasks/` + editingTask._id"
$content = $content -replace "await fetch\(`http://localhost:5000/api/tasks/\$\{id\}'", "await fetch(`${API_BASE_URL}/tasks/` + id"
$content = $content -replace "await fetch\(`http://localhost:5000/api/tasks/project/\$\{projectId\}'", "await fetch(`${API_BASE_URL}/tasks/project/` + projectId"
$content = $content -replace "await fetch\(`http://localhost:5000/api/tasks/\$\{selectedTask._id\}/comments'", "await fetch(`${API_BASE_URL}/tasks/` + selectedTask._id + '/comments'"
Set-Content $file $content

# PayrollManagement.jsx
$file = "d:\Brostech\HRMS\hrms\src\pages\admin\PayrollManagement.jsx"
$content = Get-Content $file -Raw
$content = $content -replace "import { API_BASE_URL } from '.*?config';", "import { API_BASE_URL } from '../../config';"
$content = $content -replace "fetch\(`http://localhost:5000/api/payroll\?month=\$\{selectedMonth\}'", "fetch(`${API_BASE_URL}/payroll?month=` + selectedMonth"
$content = $content -replace "'http://localhost:5000/api/payroll/generate'", "`${API_BASE_URL}/payroll/generate`"
$content = $content -replace "fetch\(`http://localhost:5000/api/payroll/\$\{payrollId\}/status'", "fetch(`${API_BASE_URL}/payroll/` + payrollId + '/status'"
Set-Content $file $content

# EmployeeList.jsx
$file = "d:\Brostech\HRMS\hrms\src\pages\admin\EmployeeList.jsx"
$content = Get-Content $file -Raw
$content = $content -replace "import { API_BASE_URL } from '.*?config';", "import { API_BASE_URL } from '../../config';"
$content = $content -replace "'http://localhost:5000/api/users'", "`${API_BASE_URL}/users`"
$content = $content -replace "'http://localhost:5000/api/users/add'", "`${API_BASE_URL}/users/add`"
$content = $content -replace "fetch\(`http://localhost:5000/api/users/\$\{editingEmployee._id\}'", "fetch(`${API_BASE_URL}/users/` + editingEmployee._id"
$content = $content -replace "fetch\(`http://localhost:5000/api/users/\$\{id\}'", "fetch(`${API_BASE_URL}/users/` + id"
Set-Content $file $content

# AttendanceTracker.jsx
$file = "d:\Brostech\HRMS\hrms\src\pages\admin\AttendanceTracker.jsx"
$content = Get-Content $file -Raw
$content = $content -replace "import { API_BASE_URL } from '.*?config';", "import { API_BASE_URL } from '../../config';"
$content = $content -replace "'http://localhost:5000/api/users'", "`${API_BASE_URL}/users`"
$content = $content -replace "fetch\(`http://localhost:5000/api/attendance/user/\$\{user._id\}'", "fetch(`${API_BASE_URL}/attendance/user/` + user._id"
$content = $content -replace "'http://localhost:5000/api/attendance'", "`${API_BASE_URL}/attendance`"
$content = $content -replace "fetch\(`http://localhost:5000/api/attendance/\$\{selectedRecord._id\}'", "fetch(`${API_BASE_URL}/attendance/` + selectedRecord._id"
Set-Content $file $content
