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
    # Test 1: Basic version check
    Write-Host "1. Testing version display..."
    $versionOutput = & $BinaryPath --version
    Write-Host "Version: $versionOutput"
    if ($versionOutput -match '^\d+\.\d+\.\d+$') {
        Write-Host "Version format valid"
    } else {
        Write-Host "Invalid version format: $versionOutput"
        exit 1
    }

    # Test 2: Help command
    Write-Host "2. Testing help command..."
    & $BinaryPath --help | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Help command works"
    } else {
        Write-Host "Help command failed"
        exit 1
    }

    # Test 3: MCP tokens command with tiktoken
    Write-Host "3. Testing tiktoken functionality..."
    $configContent = '{"mcpServers": {"test-server": {"command": "echo", "args": ["test"]}}}'
    $configContent | Out-File -FilePath test-config.json -Encoding utf8

    $env:ONE_MCP_CONFIG = "test-config.json"

    # Use separate null devices for stdout and stderr to avoid PowerShell error
    $process = Start-Process -FilePath $BinaryPath -ArgumentList "mcp", "tokens", "--help" -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\stdout.txt" -RedirectStandardError "$env:TEMP\stderr.txt"
    $completed = $process.WaitForExit(15000)  # 15 second timeout
    if (-not $completed) {
        $process.Kill()
        Write-Host "Tiktoken test timeout - likely WASM loading issue"
        Remove-Item -Force test-config.json, "$env:TEMP\stdout.txt", "$env:TEMP\stderr.txt" -ErrorAction SilentlyContinue
        exit 1
    }
    if ($process.ExitCode -eq 0) {
        Write-Host "Tiktoken functionality working"
    } else {
        Write-Host "Tiktoken test failed with exit code: $($process.ExitCode)"
        Remove-Item -Force test-config.json, "$env:TEMP\stdout.txt", "$env:TEMP\stderr.txt" -ErrorAction SilentlyContinue
        exit 1
    }

    # Test 4: System installation simulation
    Write-Host "4. Testing system installation simulation..."
    New-Item -ItemType Directory -Force -Path test-bin | Out-Null
    Copy-Item $BinaryPath test-bin\
    $binaryName = Split-Path $BinaryPath -Leaf
    $pathTestOutput = & "test-bin\$binaryName" --version
    if ($pathTestOutput -eq $versionOutput) {
        Write-Host "System installation simulation passed"
    } else {
        Write-Host "System installation failed: got $pathTestOutput, expected $versionOutput"
        Remove-Item -Recurse -Force test-bin, test-config.json, "$env:TEMP\stdout.txt", "$env:TEMP\stderr.txt" -ErrorAction SilentlyContinue
        exit 1
    }

    Remove-Item -Recurse -Force test-bin, test-config.json, "$env:TEMP\stdout.txt", "$env:TEMP\stderr.txt" -ErrorAction SilentlyContinue
    Write-Host "All $Platform binary tests passed!"

} catch {
    Write-Host "Test failed with error: $($_.Exception.Message)"
    Remove-Item -Recurse -Force test-bin, test-config.json, "$env:TEMP\stdout.txt", "$env:TEMP\stderr.txt" -ErrorAction SilentlyContinue
    exit 1
}