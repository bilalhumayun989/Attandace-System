$files = Get-ChildItem -Path "d:\Brostech\HRMS\hrms\src" -Recurse -Include *.jsx,*.js
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    if ($content -like "*http://localhost:5000/api*") {
        # Calculate relative path to config.js
        $relativePath = ""
        $depth = ($file.FullName.Replace("d:\Brostech\HRMS\hrms\src\", "").Split("\").Count - 1)
        if ($depth -eq 0) {
            $relativePath = "./config"
        } else {
            for ($i = 0; $i -lt $depth; $i++) { $relativePath += "../" }
            $relativePath += "config"
        }

        # Add import if not present
        if ($content -notlike "*import { API_BASE_URL }*") {
            $content = "import { API_BASE_URL } from '$relativePath';`n" + $content
        }

        # Replace URL
        # We need to handle both single/double quotes and template literals
        # Case 1: 'http://localhost:5000/api/...' -> `${API_BASE_URL}/...`
        $content = $content -replace "'http://localhost:5000/api(.*??)'", '`${API_BASE_URL}$1`'
        $content = $content -replace '"http://localhost:5000/api(.*?)"', '`${API_BASE_URL}$1`'
        
        # Case 2: `http://localhost:5000/api/...` -> `${API_BASE_URL}/...`
        $content = $content -replace "``http://localhost:5000/api(.*?)``", "``${API_BASE_URL}$1``"

        Set-Content -Path $file.FullName -Value $content -Encoding UTF8
    }
}
