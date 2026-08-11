#Requires -Version 5.1
<#
.SYNOPSIS
  Register or remove 1mcp serve as a Windows Task Scheduler daemon.

.DESCRIPTION
  Requires an elevated (Administrator) PowerShell session.

  The task runs as a specific Windows user account (LogonType Password).
  Credentials are prompted interactively via Get-Credential — no passwords
  are embedded in the script or the task definition.

.PARAMETER BinaryPath
  Absolute path to the 1mcp standalone binary (.exe).
  Mutually exclusive with -UseNpm.

.PARAMETER UseNpm
  Locate and use the 1mcp.cmd npm wrapper found on PATH instead of a
  standalone binary.
  Mutually exclusive with -BinaryPath.

.PARAMETER ConfigDir
  Absolute path to the 1mcp configuration directory.
  The task account is granted Modify access on this directory so it can
  write server.pid and log files.
  Default: C:\ProgramData\1mcp

.PARAMETER Port
  Port for 1mcp to listen on. Default: 3050.

.PARAMETER HostAddress
  Host address for 1mcp to bind to. Default: 127.0.0.1.

.PARAMETER TaskName
  Windows Task Scheduler task name. Default: 1mcp-daemon.

.PARAMETER Uninstall
  Stop and remove the task instead of registering it.

.PARAMETER Force
  Overwrite an existing task with the same name if it already exists.

.EXAMPLE
  # Standalone binary
  .\scripts\install-windows-task.ps1 -BinaryPath 'C:\Program Files\1mcp\1mcp.exe'

.EXAMPLE
  # npm installation
  .\scripts\install-windows-task.ps1 -UseNpm

.EXAMPLE
  # Custom config directory and port
  .\scripts\install-windows-task.ps1 -BinaryPath 'C:\1mcp\1mcp.exe' `
      -ConfigDir 'C:\ProgramData\myorg\1mcp' -Port 3051

.EXAMPLE
  # Preview changes without applying them
  .\scripts\install-windows-task.ps1 -BinaryPath 'C:\1mcp\1mcp.exe' -WhatIf

.EXAMPLE
  # Remove the task
  .\scripts\install-windows-task.ps1 -Uninstall
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Binary')]
param(
    [Parameter(ParameterSetName = 'Binary', Mandatory = $true)]
    [string]$BinaryPath,

    [Parameter(ParameterSetName = 'Npm', Mandatory = $true)]
    [switch]$UseNpm,

    [string]$ConfigDir   = "$env:APPDATA\1mcp",
    [ValidateRange(1, 65535)]
    [int]$Port           = 3050,
    [string]$HostAddress = '127.0.0.1',
    [string]$TaskName    = '1mcp-daemon',

    [Parameter(ParameterSetName = 'Uninstall', Mandatory = $true)]
    [switch]$Uninstall,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ── 1. Parameter validation ───────────────────────────────────────────────────
if ($PSCmdlet.ParameterSetName -eq 'Binary') {
    if (-not (Test-Path $BinaryPath -PathType Leaf)) {
        Write-Error "Binary not found: $BinaryPath"
    }
    $resolvedBinary = (Resolve-Path $BinaryPath).Path
}

if ($PSCmdlet.ParameterSetName -eq 'Npm') {
    try {
        $cmdWrapper = (Get-Command '1mcp.cmd' -ErrorAction Stop).Source
    } catch [System.Management.Automation.CommandNotFoundException] {
        # Fallback: Check npm global prefix if not in PATH
        $npmPrefix = ''
        try { $npmPrefix = npm prefix -g 2>$null } catch {}
        
        $cmdWrapper = if ($npmPrefix) { Join-Path $npmPrefix '1mcp.cmd' } else { '' }
        if (-not $cmdWrapper -or -not (Test-Path $cmdWrapper -PathType Leaf)) {
            Write-Error "1mcp.cmd not found in PATH or npm global prefix. Ensure the package is installed globally (e.g., 'npm install -g @1mcp/agent') or use -BinaryPath instead."
        }
    }
}

# ── 2. Path resolution ────────────────────────────────────────────────────────
$resolvedConfigDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ConfigDir)
$vbsPath = Join-Path $resolvedConfigDir '1mcp-start.vbs'

# ── 3. Uninstall path ─────────────────────────────────────────────────────────
if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "Task '$TaskName' not found — nothing to remove."
        exit 0
    }
    
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin -and -not $WhatIfPreference) {
        Write-Error 'This script must run from an elevated (Administrator) PowerShell session.'
    }

    if ($PSCmdlet.ShouldProcess($TaskName, 'Unregister-ScheduledTask')) {
        Stop-ScheduledTask  -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'."

        # Clean up launcher script if present
        if (Test-Path $vbsPath -PathType Leaf) {
            Remove-Item $vbsPath -Force
        }
    }
    exit 0
}

# ── 4. Build task action ──────────────────────────────────────────────────────
$argStr = "serve --transport http --host $HostAddress --port $Port --config-dir `"$resolvedConfigDir`""

$action = New-ScheduledTaskAction `
    -Execute          'wscript.exe' `
    -Argument         "//B `"$vbsPath`"" `
    -WorkingDirectory $resolvedConfigDir

# ── 5. Trigger / settings ────────────────────────────────────────────────────
$trigger  = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

# ── 6. Task registration ──────────────────────────────────────────────────────
if ($PSCmdlet.ShouldProcess($TaskName, 'Register-ScheduledTask')) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Error 'This script must run from an elevated (Administrator) PowerShell session.'
    }

    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        if (-not $Force) {
            Write-Error "Task '$TaskName' already exists. Use -Force to overwrite."
        }
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        # Wait for the task to fully stop to release any locks
        while ((Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State -eq 'Running') {
            Start-Sleep -Seconds 1
        }
    }

    # Ensure config directory exists
    New-Item -ItemType Directory -Force -Path $resolvedConfigDir | Out-Null

    # Write VBS launcher
    $cmdToRun = if ($PSCmdlet.ParameterSetName -eq 'Binary') {
        "`"$resolvedBinary`" $argStr"
    } else {
        "`"$cmdWrapper`" $argStr"
    }
    $escapedCmd = $cmdToRun.Replace('"', '""')
    
    $vbsContent = @"
Set fso = CreateObject("Scripting.FileSystemObject")
configDir = "$resolvedConfigDir"
pidFile = configDir & "\server.pid"
ownerDir = configDir & "\runtime.owner"

If fso.FileExists(pidFile) Then
    On Error Resume Next
    Set f = fso.OpenTextFile(pidFile, 1)
    content = f.ReadAll
    f.Close
    
    Set regEx = New RegExp
    regEx.Pattern = """pid""\s*:\s*(\d+)"
    Set matches = regEx.Execute(content)
    If matches.Count > 0 Then
        pid = matches(0).SubMatches(0)
        Set wmi = GetObject("winmgmts:\\.\root\cimv2")
        Set procs = wmi.ExecQuery("Select * from Win32_Process Where ProcessId = " & pid)
        isDead = True
        If procs.Count > 0 Then
            For Each proc In procs
                cmdLine = LCase(proc.CommandLine)
                exePath = LCase(proc.ExecutablePath)
                If InStr(cmdLine, "1mcp") > 0 Or InStr(exePath, "node") > 0 Then
                    isDead = False
                End If
            Next
        End If
        If isDead Then
            fso.DeleteFile pidFile, True
            If fso.FolderExists(ownerDir) Then
                fso.DeleteFolder ownerDir, True
            End If
        End If
    End If
    On Error GoTo 0
End If

CreateObject("Wscript.Shell").Run "cmd.exe /c $escapedCmd", 0, False
"@

    [System.IO.File]::WriteAllText($vbsPath, $vbsContent, [System.Text.Encoding]::UTF8)

    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask `
        -TaskName    $TaskName `
        -Action      $action `
        -Trigger     $trigger `
        -Settings    $settings `
        -Principal   $principal `
        -Description '1MCP aggregated MCP runtime (managed by install-windows-task.ps1)' `
        -Force:$Force | Out-Null

    # ── 7. Grant Modify access on config directory ────────────────────────────
    $icaclsArgs = @($resolvedConfigDir, '/grant', "$($currentUser):(OI)(CI)M")
    & icacls $icaclsArgs | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "icacls failed with exit code $LASTEXITCODE. Could not grant permissions on '$resolvedConfigDir'."
    }
    Write-Host "Granted Modify access on '$resolvedConfigDir' to '$currentUser'."

    # ── 8. Initial start + health check ──────────────────────────────────────
    Write-Host "Starting '$TaskName' for initial verification..."
    Start-ScheduledTask -TaskName $TaskName

    $state = (Get-ScheduledTask -TaskName $TaskName).State
    Write-Host "Task state: $state"

    $probeHost = if ($HostAddress -in @('0.0.0.0', '::', '*')) { '127.0.0.1' } else { $HostAddress }
    if ($probeHost -match ':') { $probeHost = "[$probeHost]" }
    $healthUrl = "http://${probeHost}:${Port}/health/ready"
    $healthy = $false

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $resp = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) {
                Write-Host "Health check: HTTP $($resp.StatusCode)"
                $healthy = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    if (-not $healthy) {
        Write-Warning "Health endpoint did not respond within 30 s (daemon may still be starting)."
        Write-Warning "Verify: 1mcp serve --status --config-dir `"$resolvedConfigDir`""
    }

    Write-Host ''
    Write-Host "Task '$TaskName' registered successfully."
    Write-Host "  State  : $state"
    Write-Host "  Status : 1mcp serve --status --config-dir `"$resolvedConfigDir`""
    Write-Host "  Remove : .\scripts\install-windows-task.ps1 -Uninstall [-TaskName '$TaskName']"
}
