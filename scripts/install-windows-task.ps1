#Requires -Version 5.1
<#
.SYNOPSIS
  Register or remove 1mcp serve as a Windows Task Scheduler daemon.

.DESCRIPTION
  Idempotent: re-running the script re-registers the task with -Force.
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

    [string]$ConfigDir   = 'C:\ProgramData\1mcp',
    [int]$Port           = 3050,
    [string]$HostAddress = '127.0.0.1',
    [string]$TaskName    = '1mcp-daemon',

    [Parameter(ParameterSetName = 'Uninstall', Mandatory = $true)]
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# ── 1. Elevation check ────────────────────────────────────────────────────────
$currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error 'This script must run from an elevated (Administrator) PowerShell session.'
}

# ── 2. Uninstall path ─────────────────────────────────────────────────────────
if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "Task '$TaskName' not found — nothing to remove."
        exit 0
    }
    Stop-ScheduledTask  -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
    exit 0
}

# ── 3. Parameter validation ───────────────────────────────────────────────────
if ($PSCmdlet.ParameterSetName -eq 'Binary') {
    if (-not (Test-Path $BinaryPath -PathType Leaf)) {
        Write-Error "Binary not found: $BinaryPath"
    }
    $resolvedBinary = (Resolve-Path $BinaryPath).Path
}

if ($PSCmdlet.ParameterSetName -eq 'Npm') {
    $cmdWrapper = (Get-Command '1mcp.cmd' -ErrorAction Stop).Source
}

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$resolvedConfigDir = (Resolve-Path $ConfigDir).Path

# ── 4. Build task action ──────────────────────────────────────────────────────
$argStr = "serve --transport http --host $HostAddress --port $Port --config-dir `"$resolvedConfigDir`""

$action = if ($PSCmdlet.ParameterSetName -eq 'Binary') {
    New-ScheduledTaskAction `
        -Execute          $resolvedBinary `
        -Argument         $argStr `
        -WorkingDirectory $resolvedConfigDir
} else {
    New-ScheduledTaskAction `
        -Execute          'cmd.exe' `
        -Argument         "/c `"$cmdWrapper`" $argStr" `
        -WorkingDirectory $resolvedConfigDir
}

# ── 5. Trigger / settings / principal ────────────────────────────────────────
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -LogonType Password -RunLevel Limited

# ── 6. Credential prompt + registration ──────────────────────────────────────
Write-Host "Enter the Windows account credentials for task '$TaskName'."
Write-Host "(The account must have the 'Log on as a service' or 'Log on as a batch job' right.)"
$cred = Get-Credential -Message "Account for scheduled task '$TaskName'"

if ($PSCmdlet.ShouldProcess($TaskName, 'Register-ScheduledTask')) {
    Register-ScheduledTask `
        -TaskName    $TaskName `
        -Action      $action `
        -Trigger     $trigger `
        -Settings    $settings `
        -Principal   $principal `
        -User        $cred.UserName `
        -Password    $cred.GetNetworkCredential().Password `
        -Description '1MCP aggregated MCP runtime (managed by install-windows-task.ps1)' `
        -Force | Out-Null

    # ── 7. Grant Modify access on config directory ────────────────────────────
    # The task account needs Modify (not just Write) so it can create subdirs,
    # rename temp PID files atomically, and write log files.
    icacls $resolvedConfigDir /grant "$($cred.UserName):(OI)(CI)M" | Out-Null
    Write-Host "Granted Modify access on '$resolvedConfigDir' to '$($cred.UserName)'."

    # ── 8. Initial start + health check ──────────────────────────────────────
    Write-Host "Starting '$TaskName' for initial verification..."
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 5

    $state = (Get-ScheduledTask -TaskName $TaskName).State
    Write-Host "Task state: $state"

    try {
        $resp = Invoke-WebRequest `
            -UseBasicParsing "http://${HostAddress}:${Port}/health/ready" `
            -TimeoutSec 10
        Write-Host "Health check: HTTP $($resp.StatusCode)"
    } catch {
        Write-Warning "Health endpoint did not respond within 10 s (daemon may still be starting)."
        Write-Warning "Verify: 1mcp serve --status --config-dir `"$resolvedConfigDir`""
    }

    Write-Host ''
    Write-Host "Task '$TaskName' registered successfully."
    Write-Host "  State  : $state"
    Write-Host "  Status : 1mcp serve --status --config-dir `"$resolvedConfigDir`""
    Write-Host "  Remove : .\scripts\install-windows-task.ps1 -Uninstall [-TaskName '$TaskName']"
}
