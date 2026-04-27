const fs = require('fs');
const path = 'd:/Brostech/HRMS/hrms/src/pages/admin/ProjectOverview.jsx';
let content = fs.readFileSync(path, 'utf8');

// Replace URLs
content = content.replace(/'http:\/\/localhost:5000\/api\/projects'/g, '`${API_BASE_URL}/projects`');
content = content.replace(/'http:\/\/localhost:5000\/api\/users'/g, '`${API_BASE_URL}/users`');
content = content.replace(/await fetch\(``,/g, 'await fetch(`${API_BASE_URL}/projects/${id}`,');
content = content.replace(/\? ``\n\s+?: 'http:\/\/localhost:5000\/api\/projects'/g, '? `${API_BASE_URL}/projects/${newProject._id}`\n            : `${API_BASE_URL}/projects`');

fs.writeFileSync(path, content);
console.log('Fixed ProjectOverview.jsx');
