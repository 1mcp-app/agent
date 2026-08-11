# Test suite for install-windows-task.ps1
# Usage: .\scripts\test-install-windows-task.ps1 [[-ScriptPath] <path>]
#
# Does NOT require Administrator privileges.
# Does NOT register any actual Task Scheduler task.
# Follows the same plain-PowerShell pattern as test-binary-windows.ps1.

param(
    [Parameter(Mandatory = $false)]
    [string]$ScriptPath = ''
)

if (-not $ScriptPath) {
    $ScriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'install-windows-task.ps1'
}

$ErrorActionPreference = 'Stop'
$failures = 0

function Assert-Pass {
    param([string]$Label, [scriptblock]$Test)
    try {
        & $Test
        Write-Host "PASS: $Label"
    } catch {
        Write-Host "FAIL: $Label — $_"
        $script:failures++
    }
}

Write-Host "Testing $ScriptPath"
Write-Host ("─" * 60)

# ── Test 1: Script file exists ────────────────────────────────────────────────
Assert-Pass '1. Script file exists' {
    if (-not (Test-Path $ScriptPath -PathType Leaf)) {
        throw "Not found: $ScriptPath"
    }
}

# ── Test 2: PowerShell syntax is valid (0 parse errors) ──────────────────────
Assert-Pass '2. Syntax: 0 parse errors' {
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path $ScriptPath).Path, [ref]$null, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count -gt 0) {
        throw ($parseErrors | Format-List | Out-String)
    }
}

# ── Test 3: Get-Help returns a non-empty synopsis ─────────────────────────────
Assert-Pass '3. Get-Help: synopsis present' {
    $help = Get-Help $ScriptPath -ErrorAction Stop
    if (-not $help.Synopsis -or $help.Synopsis.Trim() -eq '') {
        throw 'Synopsis is empty'
    }
}

# ── Test 4: -BinaryPath that does not exist triggers Write-Error ──────────────
# Spawn a child process so Write-Error / exit propagate cleanly.
Assert-Pass '4. -BinaryPath nonexistent: exits non-zero and prints correct error' {
    $fakePath = 'C:\nonexistent-path\1mcp.exe'
    $proc = Start-Process powershell.exe `
        -ArgumentList @(
            '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', $ScriptPath,
            '-BinaryPath', $fakePath
        ) `
        -RedirectStandardError "test-err.log" -RedirectStandardOutput "test-out.log" `
        -PassThru -Wait -NoNewWindow

    $errOutput = Get-Content "test-err.log" -ErrorAction SilentlyContinue | Out-String
    Remove-Item "test-err.log", "test-out.log" -ErrorAction SilentlyContinue

    if ($proc.ExitCode -eq 0) {
        throw "Expected non-zero exit code for missing binary, got 0"
    }
    if (-not ($errOutput -match "Binary not found")) {
        throw "Expected 'Binary not found' in output, but got: $errOutput"
    }
}

# ── Test 5: -Uninstall with a nonexistent task name exits 0 ──────────────────
Assert-Pass '5. -Uninstall nonexistent task: clean exit (code 0)' {
    $fakeName = "1mcp-test-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
    $proc = Start-Process powershell.exe `
        -ArgumentList @(
            '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', $ScriptPath,
            '-Uninstall',
            '-TaskName', $fakeName
        ) `
        -PassThru -Wait -NoNewWindow
    if ($proc.ExitCode -ne 0) {
        throw "Exit code was $($proc.ExitCode), expected 0"
    }
}

# ── Test 6: -WhatIf leaves no task registered ─────────────────────────────────
# With -WhatIf, ShouldProcess returns false so Register-ScheduledTask is skipped.
# We use an existing binary (powershell.exe) so param validation passes.
Assert-Pass '6. -WhatIf: no task is registered and no credentials prompt' {
    $fakeName = "1mcp-whatif-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
    $ps = (Get-Command powershell.exe).Source
    
    # We run in a child process to capture output and verify WhatIf message
    $proc = Start-Process powershell.exe `
        -ArgumentList @(
            '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', $ScriptPath,
            '-BinaryPath', $ps,
            '-TaskName', $fakeName,
            '-WhatIf'
        ) `
        -RedirectStandardOutput "test-out.log" -RedirectStandardError "test-err.log" `
        -PassThru -Wait -NoNewWindow
    
    $outOutput = Get-Content "test-out.log" -ErrorAction SilentlyContinue | Out-String
    $errOutput = Get-Content "test-err.log" -ErrorAction SilentlyContinue | Out-String
    Remove-Item "test-err.log", "test-out.log" -ErrorAction SilentlyContinue

    if ($proc.ExitCode -ne 0) {
        throw "Script exited with code $($proc.ExitCode). Error output: $errOutput"
    }
    if (-not ($outOutput -match "What if:")) {
        throw "Expected output to contain 'What if:', but got: $outOutput"
    }
    
    $stillAbsent = -not (Get-ScheduledTask -TaskName $fakeName -ErrorAction SilentlyContinue)
    if (-not $stillAbsent) {
        Unregister-ScheduledTask -TaskName $fakeName -Confirm:$false -ErrorAction SilentlyContinue
        throw "Task '$fakeName' was registered despite -WhatIf"
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ("─" * 60)
if ($failures -eq 0) {
    Write-Host "All tests passed."
    exit 0
} else {
    Write-Host "$failures test(s) failed."
    exit 1
}
