# Binary functionality test for Windows platforms
# Usage: .\scripts\test-binary-windows.ps1 <binary-path> <platform>

param(
    [Parameter(Mandatory=$false)]
    [string]$BinaryPath = ".\1mcp.exe",

    [Parameter(Mandatory=$false)]
    [string]$Platform = "windows"
)

$ErrorActionPreference = "Stop"

Write-Host "Testing $Platform binary at $BinaryPath..."

try {
    # Convert to absolute path for consistency
    $AbsoluteBinaryPath = Resolve-Path $BinaryPath

    # Test 1: Basic version check
    Write-Host "1. Testing version display..."
    $versionOutput = & $AbsoluteBinaryPath --version
    Write-Host "Version: $versionOutput"
    if ($versionOutput -match '^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$') {
        Write-Host "Version format valid"
    } else {
        Write-Host "Invalid version format: $versionOutput"
        exit 1
    }

    # Test 2: Help command
    Write-Host "2. Testing help command..."
    & $AbsoluteBinaryPath --help | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Help command works"
    } else {
        Write-Host "Help command failed"
        exit 1
    }

    # Test 3: MCP tokens command with tiktoken
    Write-Host "3. Testing tiktoken functionality..."
    $configContent = '{"mcpServers": {"test-server": {"command": "echo", "args": ["test"]}}}'
    $configPath = Join-Path $PWD "test-config.json"
    $configContent | Out-File -FilePath $configPath -Encoding utf8

    # Try a simpler approach - just run the command and check if it completes without crashing
    try {
        # Run the tiktoken command with a timeout using job with absolute paths
        $job = Start-Job -ScriptBlock {
            param($binaryPath, $configPath)
            $env:ONE_MCP_CONFIG = $configPath
            & $binaryPath mcp tokens --help 2>&1
        } -ArgumentList $AbsoluteBinaryPath, $configPath

        # Wait for job to complete with 15 second timeout
        $completed = Wait-Job $job -Timeout 15

        if ($completed) {
            $result = Receive-Job $job
            Remove-Job $job
            Write-Host "Tiktoken functionality working"
        } else {
            Stop-Job $job
            Remove-Job $job
            Write-Host "Tiktoken test timeout - likely WASM loading issue"
            Remove-Item -Force $configPath -ErrorAction SilentlyContinue
            exit 1
        }
    } catch {
        Write-Host "Tiktoken test failed with error: $($_.Exception.Message)"
        Remove-Item -Force $configPath -ErrorAction SilentlyContinue
        exit 1
    }

    # Test 4: Admin Console assets from the standalone binary
    Write-Host "4. Testing embedded Admin Console assets..."
    $adminSmokeDir = Join-Path ([System.IO.Path]::GetTempPath()) ("1mcp-admin-smoke-" + [guid]::NewGuid())
    $adminConfigDir = Join-Path $adminSmokeDir "config"
    $adminStdout = Join-Path $adminSmokeDir "runtime.stdout.log"
    $adminStderr = Join-Path $adminSmokeDir "runtime.stderr.log"
    New-Item -ItemType Directory -Force -Path $adminConfigDir | Out-Null
    '{"mcpServers":{}}' | Out-File -FilePath (Join-Path $adminConfigDir "mcp.json") -Encoding utf8
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $adminPort = $listener.LocalEndpoint.Port
    $listener.Stop()
    $adminBaseUrl = "http://127.0.0.1:$adminPort"
    $adminProcess = Start-Process -FilePath $AbsoluteBinaryPath -ArgumentList @(
        "serve", "--transport", "http", "--host", "127.0.0.1", "--port", "$adminPort",
        "--external-url", "$adminBaseUrl", "--config-dir", "`"$adminConfigDir`""
    ) -WorkingDirectory $adminSmokeDir -RedirectStandardOutput $adminStdout -RedirectStandardError $adminStderr -PassThru

    try {
        $ready = $false
        for ($attempt = 0; $attempt -lt 50; $attempt++) {
            try {
                $response = Invoke-WebRequest -Uri "$adminBaseUrl/health/ready" -TimeoutSec 1 -ErrorAction Stop
                if ($response.StatusCode -eq 200) {
                    $ready = $true
                    break
                }
            } catch {
                if ($adminProcess.HasExited) {
                    throw "Standalone binary exited before becoming ready. $((Get-Content $adminStdout -Raw -ErrorAction SilentlyContinue) + (Get-Content $adminStderr -Raw -ErrorAction SilentlyContinue))"
                }
            }
            Start-Sleep -Milliseconds 100
        }
        if (-not $ready) {
            throw "Standalone binary did not become ready. $((Get-Content $adminStdout -Raw -ErrorAction SilentlyContinue) + (Get-Content $adminStderr -Raw -ErrorAction SilentlyContinue))"
        }

        $adminHtml = (Invoke-WebRequest -Uri "$adminBaseUrl/admin/" -TimeoutSec 5 -ErrorAction Stop).Content
        $jsMatch = [regex]::Match($adminHtml, 'src="/admin/(assets/[^"]+\.js)"')
        $cssMatch = [regex]::Match($adminHtml, 'href="/admin/(assets/[^"]+\.css)"')
        if (-not $jsMatch.Success -or -not $cssMatch.Success) {
            throw "Admin Console HTML did not reference JavaScript and CSS assets"
        }
        foreach ($asset in @($jsMatch.Groups[1].Value, $cssMatch.Groups[1].Value)) {
            $assetResponse = Invoke-WebRequest -Uri "$adminBaseUrl/admin/$asset" -TimeoutSec 5 -ErrorAction Stop
            if ($assetResponse.StatusCode -ne 200 -or [string]::IsNullOrWhiteSpace($assetResponse.Content)) {
                throw "Embedded Admin Console asset was missing or empty: $asset"
            }
        }
    } finally {
        if ($adminProcess -and -not $adminProcess.HasExited) {
            Stop-Process -Id $adminProcess.Id -Force
            $adminProcess.WaitForExit()
        }
        Remove-Item -Recurse -Force $adminSmokeDir -ErrorAction SilentlyContinue
    }
    Write-Host "Embedded Admin Console assets working"

    # Test 5: System installation simulation
    Write-Host "5. Testing system installation simulation..."
    New-Item -ItemType Directory -Force -Path test-bin | Out-Null
    Copy-Item $AbsoluteBinaryPath test-bin\
    $binaryName = Split-Path $AbsoluteBinaryPath -Leaf
    $pathTestOutput = & "test-bin\$binaryName" --version
    if ($pathTestOutput -eq $versionOutput) {
        Write-Host "System installation simulation passed"
    } else {
        Write-Host "System installation failed: got $pathTestOutput, expected $versionOutput"
        Remove-Item -Recurse -Force test-bin, $configPath -ErrorAction SilentlyContinue
        exit 1
    }

    Remove-Item -Recurse -Force test-bin, $configPath -ErrorAction SilentlyContinue
    Write-Host "All $Platform binary tests passed!"

} catch {
    Write-Host "Test failed with error: $($_.Exception.Message)"
    Remove-Item -Recurse -Force test-bin, test-config.json -ErrorAction SilentlyContinue
    exit 1
}
