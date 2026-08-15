<#
.SYNOPSIS
  Register or remove 1mcp serve as a Windows Task Scheduler daemon.

.DESCRIPTION
  Requires an elevated (Administrator) PowerShell session.

  The task runs as a specific Windows user account (LogonType Password)
  and uses an AtStartup trigger so the daemon starts at boot in Session 0
  (no desktop window). Credentials are prompted interactively via
  Get-Credential at registration time - no passwords are embedded in the
  script or stored anywhere besides the Windows Credential Manager.

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
  Default: $env:APPDATA\1mcp

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
#Requires -Version 5.1
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
    if ($WhatIfPreference) { $resolvedBinary = $BinaryPath } else { $resolvedBinary = (Resolve-Path $BinaryPath).Path }
}

if ($PSCmdlet.ParameterSetName -eq 'Npm') {
    try {
        $cmdWrapper = (Get-Command '1mcp.cmd' -ErrorAction Stop).Source
    } catch [System.Management.Automation.CommandNotFoundException] {
        $npmPrefix = ''
        try { $npmPrefix = npm prefix -g 2>$null } catch {}
        $cmdWrapper = if ($npmPrefix) { Join-Path $npmPrefix '1mcp.cmd' } else { '' }
        if (-not $cmdWrapper -or -not (Test-Path $cmdWrapper -PathType Leaf)) {
            Write-Error "1mcp.cmd not found in PATH or npm global prefix. Ensure the package is installed globally (e.g., 'npm install -g @1mcp/agent') or use -BinaryPath instead."
        }
    }
}

# ── 2. Path resolution / current user ────────────────────────────────────────
$resolvedConfigDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ConfigDir)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

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
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'."
    }
    exit 0
}

# ── 4. Build task action ──────────────────────────────────────────────────────
# Reject shell metacharacters in HostAddress to prevent cmd.exe injection in npm mode.
if ($HostAddress -match '[&<>|@^(){};"`]') {
    Write-Error "HostAddress contains forbidden characters: '$HostAddress'. Only IPv4/IPv6 addresses and hostnames are allowed."
}

# Ensure logs directory exists for --log-file in Session 0
$logDir  = Join-Path $resolvedConfigDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'server.log'

$argStr = "serve --transport http --host $HostAddress --port $Port --config-dir `"$resolvedConfigDir`" --log-file `"$logFile`""

# ponytail: AtStartup + Password = Session 0, no console window visible — no VBS launcher needed.
$action = if ($PSCmdlet.ParameterSetName -eq 'Binary') {
    New-ScheduledTaskAction `
        -Execute          $resolvedBinary `
        -Argument         $argStr `
        -WorkingDirectory $resolvedConfigDir
} else {
    $cmdArg = '/s /c ""{0}" {1}"' -f $cmdWrapper, $argStr
    New-ScheduledTaskAction `
        -Execute          'cmd.exe' `
        -Argument         $cmdArg `
        -WorkingDirectory $resolvedConfigDir
}

# ── 5. Trigger / settings ────────────────────────────────────────────────────
$trigger  = New-ScheduledTaskTrigger -AtStartup
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

    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        if (-not $Force) {
            Write-Error "Task '$TaskName' already exists. Use -Force to overwrite."
        }
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        $stopDeadline = (Get-Date).AddSeconds(30)
        while ((Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State -eq 'Running' -and (Get-Date) -lt $stopDeadline) {
            Start-Sleep -Seconds 1
        }
        if ((Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State -eq 'Running') {
            Write-Error "Task '$TaskName' did not stop within 30 s. Cannot replace a running task."
        }
    }


    # Prompt for credentials — Get-Credential emits a Windows dialog.
    # Password is passed to Register-ScheduledTask which stores it in
    # Windows Credential Manager (DPAPI encrypted). We do NOT store it.
    $cred = Get-Credential -UserName $currentUser -Message "Enter your Windows password for the 1mcp daemon task. The password will be stored securely by Task Scheduler."
    if (-not $cred) {
        Write-Error 'Credential prompt cancelled. Cannot register task without credentials.'
    }
    $plainPassword = $cred.GetNetworkCredential().Password

    New-Item -ItemType Directory -Force -Path $resolvedConfigDir | Out-Null

    # Grant Modify access on config directory BEFORE registering the task
    # so the task account can immediately write server.pid and logs.
    $icaclsArgs = @($resolvedConfigDir, '/grant', "$($currentUser):(OI)(CI)M")
    & icacls $icaclsArgs | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "icacls failed with exit code $LASTEXITCODE. Could not grant permissions on '$resolvedConfigDir'."
    }
    Write-Host "Granted Modify access on '$resolvedConfigDir' to '$currentUser'."

    # ponytail: -User + -Password implicitly sets LogonType=Password and RunLevel=Limited.
    Register-ScheduledTask `
        -TaskName    $TaskName `
        -Action      $action `
        -Trigger     $trigger `
        -Settings    $settings `
        -User        $currentUser `
        -Password    $plainPassword `
        -Description '1MCP aggregated MCP runtime (managed by install-windows-task.ps1)' `
        -Force:$Force | Out-Null


    # ── 8. Initial start + health check ──────────────────────────────────────
    Write-Host "Starting '$TaskName' for initial verification..."
    Start-ScheduledTask -TaskName $TaskName

    $state = (Get-ScheduledTask -TaskName $TaskName).State
    Write-Host "Task state: $state"

    $probeHost = if ($HostAddress -in @('0.0.0.0', '::', '*')) { '127.0.0.1' } else { $HostAddress }
    if ($probeHost -match ':') { $probeHost = "[$probeHost]" }
    $readyUrl = "http://${probeHost}:${Port}/health/ready"
    $mcpUrl   = "http://${probeHost}:${Port}/health/mcp"
    $healthy = $false

    $healthDeadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $healthDeadline) {
        try {
            $resp = Invoke-WebRequest -UseBasicParsing -Uri $readyUrl -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) {
                Write-Host "Health /ready: HTTP $($resp.StatusCode)"
                $healthy = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    # Also verify /health/mcp (MCP gateway readiness) per author contract
    if ($healthy) {
        try {
            $mcpResp = Invoke-WebRequest -UseBasicParsing -Uri $mcpUrl -TimeoutSec 5 -ErrorAction Stop
            Write-Host "Health /mcp:   HTTP $($mcpResp.StatusCode)"
        } catch {
            Write-Warning "/health/mcp not yet responding (MCP servers may still be starting)."
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
    Write-Host "  Note   : If you change your Windows password, re-run this script to update the stored task credentials."
}

# ponytail: removed ~60 lines of VBS launcher (Session 0 has no visible window).
# ponytail: switched InteractiveToken -> Password (InteractiveToken cannot work with AtStartup).