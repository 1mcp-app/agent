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

.PARAMETER RecoveryIntervalMinutes
  Optional recurring recovery interval in whole minutes, from 1 through
  44,640. Omit this parameter to register only the AtStartup trigger.

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
  # Retry a stopped task every 60 minutes (in addition to AtStartup)
  .\scripts\install-windows-task.ps1 -UseNpm -RecoveryIntervalMinutes 60

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

    [Parameter(ParameterSetName = 'Binary')]
    [Parameter(ParameterSetName = 'Npm')]
    [ValidateScript({
        $candidate = [string]$_
        $parsed = 0L
        if ($candidate -notmatch '^[0-9]+$' -or
            -not [long]::TryParse(
                $candidate,
                [Globalization.NumberStyles]::None,
                [Globalization.CultureInfo]::InvariantCulture,
                [ref]$parsed
            ) -or
            $parsed -lt 1 -or $parsed -gt 44640) {
            throw 'RecoveryIntervalMinutes must be a whole number from 1 through 44640.'
        }
        $true
    })]
    [string]$RecoveryIntervalMinutes,

    [Parameter(ParameterSetName = 'Uninstall', Mandatory = $true)]
    [switch]$Uninstall,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Get-OptionalScheduledTask {
    param([Parameter(Mandatory = $true)][string]$TaskName)

    try {
        return Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    } catch {
        if ($_.FullyQualifiedErrorId -match 'CmdletizationQuery_NotFound_TaskName') {
            return $null
        }
        throw
    }
}

function New-1McpScheduledTaskTriggers {
    param([Nullable[int]]$RecoveryMinutes)

    $triggers = @(
        New-ScheduledTaskTrigger -AtStartup
    )

    if ($null -ne $RecoveryMinutes) {
        # Task Scheduler repetition is available only on a Once trigger. Omitting
        # RepetitionDuration makes it indefinite. Calculate the first occurrence
        # immediately before registration so it is one full interval from then.
        $minutes = [int]$RecoveryMinutes
        $triggers += New-ScheduledTaskTrigger `
            -Once `
            -At (Get-Date).AddMinutes($minutes) `
            -RepetitionInterval (New-TimeSpan -Minutes $minutes)
    }

    return $triggers
}

function New-1McpScheduledTaskSettings {
    return New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
        -RestartCount 5 `
        -RestartInterval (New-TimeSpan -Minutes 2) `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew
}

function Get-MaintenanceTaskSnapshot {
    param([Parameter(Mandatory = $true)][string]$TaskName)

    $task = Get-OptionalScheduledTask -TaskName $TaskName
    if (-not $task) {
        return [pscustomobject]@{
            Exists           = $false
            Enabled          = $false
            State            = 'NotRegistered'
            RunningInstances = 0
        }
    }

    # State can become Disabled while an already-running instance is still alive.
    # The COM API is the authoritative live-instance check used by Task Scheduler.
    $scheduler = New-Object -ComObject 'Schedule.Service'
    $scheduler.Connect()
    $folder = $scheduler.GetFolder($task.TaskPath)
    $registeredTask = $folder.GetTask($task.TaskName)
    $runningInstances = [int]$registeredTask.GetInstances(0).Count

    return [pscustomobject]@{
        Exists           = $true
        Enabled          = [bool]$task.Settings.Enabled
        State            = [string]$task.State
        RunningInstances = $runningInstances
    }
}

function New-MaintenanceFailureMessage {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$Operation,
        [Parameter(Mandatory = $true)][string]$Problem,
        [Nullable[bool]]$ShutdownConfirmed
    )

    try {
        $retainedTask = Get-OptionalScheduledTask -TaskName $TaskName
        $registration = if ($retainedTask) { 'yes' } else { 'no' }
        $enabled = if (-not $retainedTask) {
            'not registered'
        } elseif ([bool]$retainedTask.Settings.Enabled) {
            'yes'
        } else {
            'no'
        }
    } catch {
        $retainedTask = $null
        $registration = 'unconfirmed'
        $enabled = 'unconfirmed'
    }
    $shutdown = if ($null -eq $ShutdownConfirmed) {
        'unconfirmed'
    } elseif ([bool]$ShutdownConfirmed) {
        'yes'
    } else {
        'no'
    }
    $recovery = if ($registration -eq 'unconfirmed') {
        "Restore Task Scheduler access, inspect task '$TaskName' and its running instances, then retry $Operation."
    } elseif ($retainedTask -and [bool]$retainedTask.Settings.Enabled) {
        "Disable task '$TaskName', stop its running instances, verify Task Scheduler reports no running instances, then retry $Operation."
    } elseif ($retainedTask) {
        "Task '$TaskName' remains disabled. Stop or wait for every running instance, verify Task Scheduler reports no running instances, then retry $Operation. Re-enable it explicitly only if you intend to resume automatic execution."
    } else {
        "Verify that no instance owned by task '$TaskName' remains running, then retry $Operation."
    }

    return @(
        "$Problem"
        "Registration remains: $registration."
        "Task enabled: $enabled."
        "Shutdown confirmed: $shutdown."
        "Recovery: $recovery"
    ) -join [Environment]::NewLine
}

function Stop-TaskForMaintenance {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$Operation,
        [ValidateRange(1, 300)][int]$TimeoutSeconds = 30
    )

    try {
        Disable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
    } catch {
        throw (New-MaintenanceFailureMessage `
            -TaskName $TaskName `
            -Operation $Operation `
            -Problem "Could not disable task '$TaskName' before $Operation`: $($_.Exception.Message)" `
            -ShutdownConfirmed $null)
    }

    try {
        $snapshot = Get-MaintenanceTaskSnapshot -TaskName $TaskName
    } catch {
        throw (New-MaintenanceFailureMessage `
            -TaskName $TaskName `
            -Operation $Operation `
            -Problem "Task '$TaskName' was disabled, but its running instances could not be inspected before $Operation`: $($_.Exception.Message)" `
            -ShutdownConfirmed $null)
    }

    if ($snapshot.Exists -and $snapshot.Enabled) {
        throw (New-MaintenanceFailureMessage `
            -TaskName $TaskName `
            -Operation $Operation `
            -Problem "Task '$TaskName' did not remain disabled before $Operation." `
            -ShutdownConfirmed $null)
    }

    if ($snapshot.RunningInstances -gt 0) {
        try {
            Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        } catch {
            $stopError = $_.Exception.Message
            try {
                $snapshot = Get-MaintenanceTaskSnapshot -TaskName $TaskName
            } catch {
                throw (New-MaintenanceFailureMessage `
                    -TaskName $TaskName `
                    -Operation $Operation `
                    -Problem "Stopping task '$TaskName' failed and shutdown could not be inspected before $Operation`: $($_.Exception.Message)" `
                    -ShutdownConfirmed $null)
            }
            $shutdownConfirmed = $snapshot.RunningInstances -eq 0
            throw (New-MaintenanceFailureMessage `
                -TaskName $TaskName `
                -Operation $Operation `
                -Problem "Could not stop task '$TaskName' before $Operation`: $stopError" `
                -ShutdownConfirmed $shutdownConfirmed)
        }
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($snapshot.Exists -and $snapshot.RunningInstances -gt 0 -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
        try {
            $snapshot = Get-MaintenanceTaskSnapshot -TaskName $TaskName
        } catch {
            throw (New-MaintenanceFailureMessage `
                -TaskName $TaskName `
                -Operation $Operation `
                -Problem "Shutdown inspection failed while waiting to $Operation task '$TaskName'`: $($_.Exception.Message)" `
                -ShutdownConfirmed $null)
        }
    }

    if ($snapshot.Exists -and $snapshot.RunningInstances -gt 0) {
        throw (New-MaintenanceFailureMessage `
            -TaskName $TaskName `
            -Operation $Operation `
            -Problem "Task '$TaskName' did not stop within $TimeoutSeconds s. Cannot $Operation while an instance is running." `
            -ShutdownConfirmed $false)
    }

    return $snapshot
}

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
    $existing = Get-OptionalScheduledTask -TaskName $TaskName
    if (-not $existing) {
        Write-Host "Task '$TaskName' not found — nothing to remove."
        exit 0
    }

    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin -and -not $WhatIfPreference) {
        Write-Error 'This script must run from an elevated (Administrator) PowerShell session.'
    }

    if ($PSCmdlet.ShouldProcess($TaskName, 'Disable, stop, and unregister scheduled task')) {
        Stop-TaskForMaintenance -TaskName $TaskName -Operation 'uninstall' -TimeoutSeconds 30 | Out-Null
        try {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
            if (Get-OptionalScheduledTask -TaskName $TaskName) {
                throw "Task '$TaskName' is still registered after Unregister-ScheduledTask completed."
            }
        } catch {
            try {
                if (Get-OptionalScheduledTask -TaskName $TaskName) {
                    Disable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
                }
            } catch {}
            throw (New-MaintenanceFailureMessage `
                -TaskName $TaskName `
                -Operation 'uninstall' `
                -Problem "Could not unregister task '$TaskName' after its shutdown was confirmed: $($_.Exception.Message)" `
                -ShutdownConfirmed $true)
        }
        Write-Host "Removed scheduled task '$TaskName' after confirming shutdown."
    }
    exit 0
}

# ── 4. Build task action ──────────────────────────────────────────────────────
# Reject shell metacharacters in HostAddress to prevent cmd.exe injection in npm mode.
if ($HostAddress -match '[&<>|@^(){};"`]') {
    Write-Error "HostAddress contains forbidden characters: '$HostAddress'. Only IPv4/IPv6 addresses and hostnames are allowed."
}

# The directories are created only after ShouldProcess approves registration.
$logDir  = Join-Path $resolvedConfigDir 'logs'
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

# ── 5. Settings ──────────────────────────────────────────────────────────────
$settings = New-1McpScheduledTaskSettings

# ── 6. Task registration ──────────────────────────────────────────────────────
if ($PSCmdlet.ShouldProcess($TaskName, 'Register-ScheduledTask')) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Error 'This script must run from an elevated (Administrator) PowerShell session.'
    }

    $existingTask = Get-OptionalScheduledTask -TaskName $TaskName
    if ($existingTask -and -not $Force) {
        Write-Error "Task '$TaskName' already exists. Use -Force to overwrite."
    }

    # Prompt for credentials before disabling an existing task. Cancelling the
    # prompt therefore cannot disrupt the currently registered task.
    # Password is passed to Register-ScheduledTask which stores it in
    # Windows Credential Manager (DPAPI encrypted). We do NOT store it.
    $cred = Get-Credential -UserName $currentUser -Message "Enter your Windows password for the 1mcp daemon task. The password will be stored securely by Task Scheduler."
    if (-not $cred) {
        Write-Error 'Credential prompt cancelled. Cannot register task without credentials.'
    }
    $plainPassword = $cred.GetNetworkCredential().Password

    $maintenancePerformed = $false
    try {
        if ($existingTask) {
            Stop-TaskForMaintenance -TaskName $TaskName -Operation 'replace' -TimeoutSeconds 30 | Out-Null
            $maintenancePerformed = $true
        }

        New-Item -ItemType Directory -Force -Path $resolvedConfigDir | Out-Null
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null

        # Grant Modify access on config directory BEFORE registering the task
        # so the task account can immediately write server.pid and logs.
        $icaclsArgs = @($resolvedConfigDir, '/grant', "$($currentUser):(OI)(CI)M")
        & icacls $icaclsArgs | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "icacls failed with exit code $LASTEXITCODE. Could not grant permissions on '$resolvedConfigDir'."
        }
        Write-Host "Granted Modify access on '$resolvedConfigDir' to '$currentUser'."

        $recoveryMinutes = if ($PSBoundParameters.ContainsKey('RecoveryIntervalMinutes')) {
            [int]$RecoveryIntervalMinutes
        } else {
            $null
        }
        $triggers = New-1McpScheduledTaskTriggers -RecoveryMinutes $recoveryMinutes

        # ponytail: -User + -Password implicitly sets LogonType=Password and RunLevel=Limited.
        Register-ScheduledTask `
            -TaskName    $TaskName `
            -Action      $action `
            -Trigger     $triggers `
            -Settings    $settings `
            -User        $currentUser `
            -Password    $plainPassword `
            -Description '1MCP aggregated MCP runtime (managed by install-windows-task.ps1)' `
            -Force:$Force | Out-Null
    } catch {
        if ($maintenancePerformed) {
            $replacementError = $_.Exception.Message
            try {
                if (Get-OptionalScheduledTask -TaskName $TaskName) {
                    Disable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
                }
            } catch {}
            throw (New-MaintenanceFailureMessage `
                -TaskName $TaskName `
                -Operation 'replacement' `
                -Problem "Replacement failed after the prior registration was disabled and its shutdown confirmed: $replacementError" `
                -ShutdownConfirmed $true)
        }
        throw
    }


    # ── 8. Initial start + health check ──────────────────────────────────────
    Write-Host "Starting '$TaskName' for initial verification..."
    try {
        Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        $state = (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).State
    } catch {
        $startError = $_.Exception.Message
        try {
            Stop-TaskForMaintenance `
                -TaskName $TaskName `
                -Operation 'recover from failed initial start' `
                -TimeoutSeconds 30 | Out-Null
        } catch {
            throw "Initial start or state verification failed: $startError$([Environment]::NewLine)$($_.Exception.Message)"
        }
        throw (New-MaintenanceFailureMessage `
            -TaskName $TaskName `
            -Operation 'retry installation' `
            -Problem "Initial start or state verification failed after registration: $startError" `
            -ShutdownConfirmed $true)
    }
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
    if ($PSBoundParameters.ContainsKey('RecoveryIntervalMinutes')) {
        Write-Host "  Recovery: every $RecoveryIntervalMinutes minute(s) while enabled"
    } else {
        Write-Host '  Recovery: AtStartup only'
    }
    Write-Host "  Status : 1mcp serve --status --config-dir `"$resolvedConfigDir`""
    Write-Host "  Remove : .\scripts\install-windows-task.ps1 -Uninstall [-TaskName '$TaskName']"
    Write-Host "  Note   : If you change your Windows password, re-run this script to update the stored task credentials."
}

# ponytail: removed ~60 lines of VBS launcher (Session 0 has no visible window).
# ponytail: switched InteractiveToken -> Password (InteractiveToken cannot work with AtStartup).
