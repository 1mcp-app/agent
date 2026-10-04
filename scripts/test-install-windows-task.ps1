# Test suite for install-windows-task.ps1
# Usage: .\scripts\test-install-windows-task.ps1 [[-ScriptPath] <path>] [-Portable]
#
# Does NOT require Administrator privileges.
# Does NOT register any actual Task Scheduler task.
# Follows the same plain-PowerShell pattern as test-binary-windows.ps1.

param(
    [Parameter(Mandatory = $false)]
    [string]$ScriptPath = '',

    [switch]$Portable
)

if (-not $ScriptPath) {
    $ScriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'install-windows-task.ps1'
}

$ErrorActionPreference = 'Stop'
$failures = 0
$PowerShellExecutable = (Get-Process -Id $PID).Path

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

function Import-ScriptFunction {
    param([Parameter(Mandatory = $true)][string]$Name)

    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path $ScriptPath).Path,
        [ref]$tokens,
        [ref]$parseErrors
    )
    if ($parseErrors.Count -gt 0) {
        throw ($parseErrors | Format-List | Out-String)
    }

    $functionAst = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq $Name
    }, $true)
    if (-not $functionAst) {
        throw "Function '$Name' was not found in $ScriptPath"
    }

    $body = $functionAst.Body.Extent.Text
    $bodyWithoutBraces = $body.Substring(1, $body.Length - 2)
    Set-Item -Path "Function:script:$Name" -Value ([scriptblock]::Create($bodyWithoutBraces))
}

function Invoke-MockedInstaller {
    param(
        [hashtable]$Arguments,
        [bool]$ExistingTask = $true,
        [int]$RunningInstances = 1,
        [bool]$StopSucceeds = $true,
        [bool]$StartFails = $false,
        [bool]$AdvancePastStopDeadline = $false
    )

    $script:mockTask = if ($ExistingTask) {
        [pscustomobject]@{
            TaskName = [string]$Arguments.TaskName
            TaskPath = '\'
            State = if ($RunningInstances -gt 0) { 'Running' } else { 'Ready' }
            Settings = [pscustomobject]@{ Enabled = $true }
        }
    } else {
        $null
    }
    $script:mockRunningInstances = $RunningInstances
    $script:mockStopSucceeds = $StopSucceeds
    $script:mockStartFails = $StartFails
    $script:mockAdvancePastStopDeadline = $AdvancePastStopDeadline
    $script:mockNow = [datetime]'2026-01-01T00:00:00'
    $script:mockEvents = @()
    $script:registeredTriggers = @()

    function Get-ScheduledTask {
        [CmdletBinding()]
        param([string]$TaskName)
        if (-not $script:mockTask) {
            $notFound = [System.Management.Automation.ErrorRecord]::new(
                [System.Management.Automation.ItemNotFoundException]::new("Task '$TaskName' was not found."),
                'CmdletizationQuery_NotFound_TaskName',
                [System.Management.Automation.ErrorCategory]::ObjectNotFound,
                $TaskName
            )
            throw $notFound
        }
        $script:mockTask.State = if ($script:mockRunningInstances -gt 0) {
            if ($script:mockTask.Settings.Enabled) { 'Running' } else { 'Disabled' }
        } elseif ($script:mockTask.Settings.Enabled) {
            'Ready'
        } else {
            'Disabled'
        }
        return $script:mockTask
    }
    function Disable-ScheduledTask {
        [CmdletBinding()]
        param([string]$TaskName)
        $script:mockEvents += 'disable'
        $script:mockTask.Settings.Enabled = $false
        return $script:mockTask
    }
    function Stop-ScheduledTask {
        [CmdletBinding()]
        param([string]$TaskName)
        $script:mockEvents += 'stop'
        if ($script:mockStopSucceeds) {
            $script:mockRunningInstances = 0
        }
    }
    function Unregister-ScheduledTask {
        [CmdletBinding()]
        param([string]$TaskName, [switch]$Confirm)
        $script:mockEvents += 'unregister'
        $script:mockTask = $null
        $script:mockRunningInstances = 0
    }
    function Register-ScheduledTask {
        [CmdletBinding()]
        param(
            [string]$TaskName,
            $Action,
            $Trigger,
            $Settings,
            [string]$User,
            [string]$Password,
            [string]$Description,
            [switch]$Force
        )
        $script:mockEvents += 'register'
        $script:registeredTriggers = @($Trigger)
        $script:mockTask = [pscustomobject]@{
            TaskName = $TaskName
            TaskPath = '\'
            State = 'Ready'
            Settings = [pscustomobject]@{ Enabled = $true }
        }
        return $script:mockTask
    }
    function Start-ScheduledTask {
        [CmdletBinding()]
        param([string]$TaskName)
        $script:mockEvents += 'start'
        if ($script:mockStartFails) {
            throw 'mock start failure'
        }
        $script:mockRunningInstances = 1
    }
    function New-ScheduledTaskAction {
        param([string]$Execute, [string]$Argument, [string]$WorkingDirectory)
        return [pscustomobject]@{ Execute = $Execute; Argument = $Argument; WorkingDirectory = $WorkingDirectory }
    }
    function New-ScheduledTaskTrigger {
        param([switch]$AtStartup, [switch]$Once, [datetime]$At, [timespan]$RepetitionInterval)
        return [pscustomobject]@{
            AtStartup = $AtStartup.IsPresent
            Once = $Once.IsPresent
            At = $At
            RepetitionInterval = $RepetitionInterval
        }
    }
    function New-ScheduledTaskSettingsSet {
        param(
            [switch]$AllowStartIfOnBatteries,
            [switch]$DontStopIfGoingOnBatteries,
            [timespan]$ExecutionTimeLimit,
            [int]$RestartCount,
            [timespan]$RestartInterval,
            [switch]$StartWhenAvailable,
            [string]$MultipleInstances
        )
        return [pscustomobject]@{
            RestartCount = $RestartCount
            RestartInterval = $RestartInterval
            MultipleInstances = $MultipleInstances
        }
    }
    function New-Object {
        param([string]$ComObject)
        $script:mockRegisteredCom = [pscustomobject]@{}
        $script:mockRegisteredCom | Add-Member -MemberType ScriptMethod -Name GetInstances -Value {
            param($Flags)
            return [pscustomobject]@{ Count = $script:mockRunningInstances }
        }
        $script:mockFolderCom = [pscustomobject]@{}
        $script:mockFolderCom | Add-Member -MemberType ScriptMethod -Name GetTask -Value {
            param($TaskName)
            return $script:mockRegisteredCom
        }
        $script:mockSchedulerCom = [pscustomobject]@{}
        $script:mockSchedulerCom | Add-Member -MemberType ScriptMethod -Name Connect -Value { }
        $script:mockSchedulerCom | Add-Member -MemberType ScriptMethod -Name GetFolder -Value {
            param($TaskPath)
            return $script:mockFolderCom
        }
        return $script:mockSchedulerCom
    }
    function New-Item { param([Parameter(ValueFromRemainingArguments = $true)]$Remaining) }
    function icacls {
        param([Parameter(ValueFromRemainingArguments = $true)]$Remaining)
        $global:LASTEXITCODE = 0
    }
    function Get-Credential {
        param([string]$UserName, [string]$Message)
        $securePassword = ConvertTo-SecureString 'mock-password' -AsPlainText -Force
        return [pscredential]::new($UserName, $securePassword)
    }
    function Invoke-WebRequest {
        param(
            [switch]$UseBasicParsing,
            [string]$Uri,
            [int]$TimeoutSec
        )
        return [pscustomobject]@{ StatusCode = 200 }
    }
    function Start-Sleep { param([int]$Seconds) }
    function Get-Date {
        if ($script:mockAdvancePastStopDeadline) {
            $script:mockNow = $script:mockNow.AddSeconds(31)
            return $script:mockNow
        }
        return [datetime]::Now
    }

    $source = Get-Content $ScriptPath -Raw
    $source = $source.Replace(
        '$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name',
        '$currentUser = ''TEST\installer'''
    )
    $adminExpression = '$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
    $source = $source.Replace($adminExpression, '$isAdmin = $true')
    $source = [regex]::Replace($source, '(?m)^\s*exit 0\s*$', 'return')

    $caughtError = $null
    $output = ''
    try {
        $output = & ([scriptblock]::Create($source)) @Arguments 6>&1 5>&1 4>&1 3>&1 2>&1 | Out-String
    } catch {
        $caughtError = $_
    }

    return [pscustomobject]@{
        Error = $caughtError
        Output = $output
        Events = @($script:mockEvents)
        Task = $script:mockTask
        RunningInstances = $script:mockRunningInstances
        Triggers = @($script:registeredTriggers)
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
    if (-not $help.Synopsis -or $help.Synopsis.Trim() -ne 'Register or remove 1mcp serve as a Windows Task Scheduler daemon.') {
        throw "Synopsis mismatch: expected 'Register or remove 1mcp serve as a Windows Task Scheduler daemon.', got: '$($help.Synopsis)'"
    }
}

# ── Test 4: -BinaryPath that does not exist triggers Write-Error ──────────────
Assert-Pass '4. -BinaryPath nonexistent: exits non-zero and prints correct error' {
    $fakePath = 'C:\nonexistent-path\1mcp.exe'
    $tempErr = [System.IO.Path]::GetTempFileName()
    $tempOut = [System.IO.Path]::GetTempFileName()
    $proc = Start-Process $PowerShellExecutable `
        -ArgumentList @(
            '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', ('"{0}"' -f $ScriptPath),
            '-BinaryPath', $fakePath
        ) `
        -RedirectStandardError $tempErr -RedirectStandardOutput $tempOut `
        -PassThru -Wait -NoNewWindow

    $errOutput = Get-Content $tempErr -ErrorAction SilentlyContinue | Out-String
    Remove-Item $tempErr, $tempOut -ErrorAction SilentlyContinue

    if ($proc.ExitCode -eq 0) {
        throw "Expected non-zero exit code for missing binary, got 0"
    }
    if (-not ($errOutput -match "Binary not found")) {
        throw "Expected 'Binary not found' in output, but got: $errOutput"
    }
}

# ── Test 5: -Uninstall with a nonexistent task name exits 0 ──────────────────
if (-not $Portable) {
Assert-Pass '5. -Uninstall nonexistent task: clean exit (code 0)' {
    $fakeName = "1mcp-test-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
    $proc = Start-Process $PowerShellExecutable `
        -ArgumentList @(
            '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', ('"{0}"' -f $ScriptPath),
            '-Uninstall',
            '-TaskName', $fakeName
        ) `
        -PassThru -Wait -NoNewWindow
    if ($proc.ExitCode -ne 0) {
        throw "Exit code was $($proc.ExitCode), expected 0"
    }
}
} else {
    Write-Host 'SKIP: 5. -Uninstall nonexistent task (requires Windows ScheduledTasks)'
}

# ── Test 6: -WhatIf leaves no task and mentions LogonType Password ────────────
if (-not $Portable) {
Assert-Pass '6. -WhatIf: no task registered, mentions Password logon, no cred prompt' {
    $fakeName = "1mcp-whatif-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
    $ps = (Get-Command powershell.exe).Source

    $tempErr = [System.IO.Path]::GetTempFileName()
    $tempOut = [System.IO.Path]::GetTempFileName()
    $proc = Start-Process $PowerShellExecutable `
        -ArgumentList @(
            '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', ('"{0}"' -f $ScriptPath),
            '-BinaryPath', ('"{0}"' -f $ps),
            '-TaskName', $fakeName,
            '-WhatIf'
        ) `
        -RedirectStandardOutput $tempOut -RedirectStandardError $tempErr `
        -PassThru -Wait -NoNewWindow

    $outOutput = Get-Content $tempOut -ErrorAction SilentlyContinue | Out-String
    $errOutput = Get-Content $tempErr -ErrorAction SilentlyContinue | Out-String
    Remove-Item $tempErr, $tempOut -ErrorAction SilentlyContinue

    if ($proc.ExitCode -ne 0) {
        throw "Script exited with code $($proc.ExitCode). Error output: $errOutput"
    }
    if (-not ($outOutput -match 'Register-ScheduledTask')) {
        throw "Expected output to contain 'What if:' (or localized equivalent), but got: $outOutput"
    }

    $taskLookup = $null
    try {
        $taskLookup = Get-ScheduledTask -TaskName $fakeName -ErrorAction Stop
    } catch {
        if ($_.FullyQualifiedErrorId -notmatch 'CmdletizationQuery_NotFound_TaskName') {
            throw "Unexpected error checking task '$fakeName': $_"
        }
    }
    $stillAbsent = -not $taskLookup
    if (-not $stillAbsent) {
        Unregister-ScheduledTask -TaskName $fakeName -Confirm:$false -ErrorAction SilentlyContinue
        throw "Task '$fakeName' was registered despite -WhatIf"
    }
}
} else {
    Write-Host 'SKIP: 6. -WhatIf task registration check (requires Windows ScheduledTasks)'
}

# ── Test 7: Recovery interval rejects invalid values before script body ───────
Assert-Pass '7. Recovery interval: invalid values fail before binary/task mutation' {
    foreach ($invalidValue in @('0', '-1', '1.5', '44641', '999999999999999999999')) {
        $tempErr = [System.IO.Path]::GetTempFileName()
        $tempOut = [System.IO.Path]::GetTempFileName()
        $proc = Start-Process $PowerShellExecutable `
            -ArgumentList @(
                '-NoProfile', '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-File', ('"{0}"' -f $ScriptPath),
                '-BinaryPath', 'C:\nonexistent-path\1mcp.exe',
                '-RecoveryIntervalMinutes', $invalidValue
            ) `
            -RedirectStandardError $tempErr -RedirectStandardOutput $tempOut `
            -PassThru -Wait -NoNewWindow

        $output = ((Get-Content $tempErr -ErrorAction SilentlyContinue) +
            (Get-Content $tempOut -ErrorAction SilentlyContinue)) | Out-String
        Remove-Item $tempErr, $tempOut -ErrorAction SilentlyContinue

        if ($proc.ExitCode -eq 0) {
            throw "Expected non-zero exit code for interval '$invalidValue'"
        }
        if ($output -notmatch 'RecoveryIntervalMinutes must be a whole number from 1 through 44640') {
            throw "Expected strict interval error for '$invalidValue', got: $output"
        }
        if ($output -match 'Binary not found') {
            throw "Script body ran before interval '$invalidValue' was rejected: $output"
        }
    }
}

# ── Test 8: Boundary values bind and WhatIf leaves filesystem untouched ──────
if (-not $Portable) {
Assert-Pass '8. Recovery interval: 1 and 44640 bind without WhatIf mutation' {
    foreach ($validValue in @('1', '44640')) {
        $fakeName = "1mcp-boundary-$validValue-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
        $configDir = Join-Path ([System.IO.Path]::GetTempPath()) $fakeName
        $tempErr = [System.IO.Path]::GetTempFileName()
        $tempOut = [System.IO.Path]::GetTempFileName()
        $proc = Start-Process $PowerShellExecutable `
            -ArgumentList @(
                '-NoProfile', '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-File', ('"{0}"' -f $ScriptPath),
                '-BinaryPath', ('"{0}"' -f $PowerShellExecutable),
                '-ConfigDir', ('"{0}"' -f $configDir),
                '-TaskName', $fakeName,
                '-RecoveryIntervalMinutes', $validValue,
                '-WhatIf'
            ) `
            -RedirectStandardError $tempErr -RedirectStandardOutput $tempOut `
            -PassThru -Wait -NoNewWindow

        $output = ((Get-Content $tempErr -ErrorAction SilentlyContinue) +
            (Get-Content $tempOut -ErrorAction SilentlyContinue)) | Out-String
        Remove-Item $tempErr, $tempOut -ErrorAction SilentlyContinue

        if ($proc.ExitCode -ne 0) {
            throw "Boundary '$validValue' failed to bind: $output"
        }
        if (Test-Path $configDir) {
            throw "-WhatIf created config directory '$configDir'"
        }
        if (Get-ScheduledTask -TaskName $fakeName -ErrorAction SilentlyContinue) {
            throw "-WhatIf registered task '$fakeName'"
        }
    }
}
} else {
    Write-Host 'SKIP: 8. Recovery interval WhatIf task check (requires Windows ScheduledTasks)'
}

# ── Test 9: Trigger construction keeps startup and indefinite recurrence ─────
Assert-Pass '9. Trigger construction: AtStartup plus one indefinite Once repetition' {
    Import-ScriptFunction -Name 'New-1McpScheduledTaskTriggers'
    $script:triggerCalls = @()

    function New-ScheduledTaskTrigger {
        [CmdletBinding()]
        param(
            [switch]$AtStartup,
            [switch]$Once,
            [datetime]$At,
            [timespan]$RepetitionInterval
        )
        $call = [pscustomobject]@{
            AtStartup          = $AtStartup.IsPresent
            Once               = $Once.IsPresent
            At                 = $At
            RepetitionInterval = $RepetitionInterval
            Parameters         = @($PSBoundParameters.Keys)
        }
        $script:triggerCalls += $call
        return $call
    }

    $startupOnly = @(New-1McpScheduledTaskTriggers -RecoveryMinutes $null)
    if ($startupOnly.Count -ne 1 -or -not $startupOnly[0].AtStartup) {
        throw 'Omitted interval did not produce exactly one AtStartup trigger.'
    }

    $script:triggerCalls = @()
    $before = Get-Date
    $withRecovery = @(New-1McpScheduledTaskTriggers -RecoveryMinutes 60)
    $after = Get-Date
    if ($withRecovery.Count -ne 2 -or -not $withRecovery[0].AtStartup -or -not $withRecovery[1].Once) {
        throw 'Opt-in interval did not produce separate AtStartup and Once triggers.'
    }
    if ($withRecovery[1].RepetitionInterval.TotalMinutes -ne 60) {
        throw "Repetition interval was $($withRecovery[1].RepetitionInterval.TotalMinutes), expected 60."
    }
    if ($withRecovery[1].At -lt $before.AddMinutes(60) -or $withRecovery[1].At -gt $after.AddMinutes(60)) {
        throw "First recurrence was not one interval from trigger construction: $($withRecovery[1].At)"
    }
    if ($withRecovery[1].Parameters -contains 'RepetitionDuration') {
        throw 'RepetitionDuration must be omitted for indefinite recurrence.'
    }

    $maximum = @(New-1McpScheduledTaskTriggers -RecoveryMinutes 44640)
    if ($maximum[1].RepetitionInterval.TotalDays -ne 31) {
        throw 'Maximum recovery interval must produce exactly 31 days.'
    }
}

# ── Test 10: Maintenance uses live instance count after disabling ─────────────
Assert-Pass '10. Maintenance: disable precedes stop and live instances reach zero' {
    Import-ScriptFunction -Name 'Stop-TaskForMaintenance'
    $script:maintenanceEvents = @()
    $script:snapshotIndex = 0
    $snapshots = @(
        [pscustomobject]@{ Exists = $true; Enabled = $false; State = 'Disabled'; RunningInstances = 1 },
        [pscustomobject]@{ Exists = $true; Enabled = $false; State = 'Disabled'; RunningInstances = 0 }
    )

    function Disable-ScheduledTask {
        [CmdletBinding()]
        param([string]$TaskName)
        $script:maintenanceEvents += 'disable'
    }
    function Stop-ScheduledTask {
        [CmdletBinding()]
        param([string]$TaskName)
        $script:maintenanceEvents += 'stop'
    }
    function Get-MaintenanceTaskSnapshot {
        param([string]$TaskName)
        $script:maintenanceEvents += 'snapshot'
        $value = $snapshots[[Math]::Min($script:snapshotIndex, $snapshots.Count - 1)]
        $script:snapshotIndex++
        return $value
    }
    function Start-Sleep {
        param([int]$Seconds)
        $script:maintenanceEvents += 'wait'
    }

    $result = Stop-TaskForMaintenance -TaskName 'mock-task' -Operation 'replace' -TimeoutSeconds 30
    if ($result.RunningInstances -ne 0) {
        throw 'Maintenance returned before live instance count reached zero.'
    }
    if (($script:maintenanceEvents -join ',') -ne 'disable,snapshot,stop,wait,snapshot') {
        throw "Unexpected maintenance order: $($script:maintenanceEvents -join ',')"
    }
}

# ── Test 11: Timed-out maintenance is fail-closed and actionable ──────────────
Assert-Pass '11. Maintenance timeout: retained task stays disabled with status report' {
    Import-ScriptFunction -Name 'Stop-TaskForMaintenance'
    Import-ScriptFunction -Name 'New-MaintenanceFailureMessage'
    $script:fakeNow = [datetime]'2026-01-01T00:00:00'

    function Disable-ScheduledTask { [CmdletBinding()] param([string]$TaskName) }
    function Stop-ScheduledTask { [CmdletBinding()] param([string]$TaskName) }
    function Get-MaintenanceTaskSnapshot {
        param([string]$TaskName)
        return [pscustomobject]@{ Exists = $true; Enabled = $false; State = 'Disabled'; RunningInstances = 1 }
    }
    function Get-OptionalScheduledTask {
        param([string]$TaskName)
        return [pscustomobject]@{
            State = 'Disabled'
            Settings = [pscustomobject]@{ Enabled = $false }
        }
    }
    function Get-Date {
        $script:fakeNow = $script:fakeNow.AddSeconds(2)
        return $script:fakeNow
    }
    function Start-Sleep { param([int]$Seconds) }

    try {
        Stop-TaskForMaintenance -TaskName 'mock-task' -Operation 'replace' -TimeoutSeconds 1
        throw 'Expected maintenance timeout.'
    } catch {
        $message = $_.Exception.Message
        foreach ($requiredText in @(
            'did not stop within 1 s',
            'Registration remains: yes',
            'Task enabled: no',
            'Shutdown confirmed: no',
            'remains disabled',
            'Recovery:'
        )) {
            if ($message -notmatch [regex]::Escape($requiredText)) {
                throw "Timeout error omitted '$requiredText': $message"
            }
        }
    }
}

# ── Test 12: Stop errors block mutation even after the instance disappears ───
Assert-Pass '12. Maintenance stop error: blocks mutation after refreshed zero instances' {
    Import-ScriptFunction -Name 'Stop-TaskForMaintenance'
    Import-ScriptFunction -Name 'New-MaintenanceFailureMessage'
    $script:stopErrorSnapshot = 0

    function Disable-ScheduledTask { [CmdletBinding()] param([string]$TaskName) }
    function Stop-ScheduledTask {
        [CmdletBinding()]
        param([string]$TaskName)
        $script:stopErrorSnapshot = 1
        throw 'mock Stop-ScheduledTask error'
    }
    function Get-MaintenanceTaskSnapshot {
        param([string]$TaskName)
        $instances = if ($script:stopErrorSnapshot -eq 0) { 1 } else { 0 }
        return [pscustomobject]@{ Exists = $true; Enabled = $false; State = 'Disabled'; RunningInstances = $instances }
    }
    function Get-OptionalScheduledTask {
        param([string]$TaskName)
        return [pscustomobject]@{ Settings = [pscustomobject]@{ Enabled = $false } }
    }

    try {
        Stop-TaskForMaintenance -TaskName 'mock-task' -Operation 'replace' -TimeoutSeconds 30
        throw 'Expected Stop-ScheduledTask failure to block replacement.'
    } catch {
        $message = $_.Exception.Message
        if ($message -notmatch 'mock Stop-ScheduledTask error' -or
            $message -notmatch 'Shutdown confirmed: yes' -or
            $message -notmatch 'Task enabled: no') {
            throw "Stop failure report was incomplete: $message"
        }
    }
}

# ── Test 13: Full replacement path fails closed on stop timeout ───────────────
Assert-Pass '13. Replacement timeout: does not register or start and stays disabled' {
    $result = Invoke-MockedInstaller `
        -Arguments @{
            BinaryPath = $PowerShellExecutable
            ConfigDir = (Join-Path ([System.IO.Path]::GetTempPath()) '1mcp-mock-replace-timeout')
            TaskName = 'mock-replace-timeout'
            Force = $true
        } `
        -StopSucceeds $false `
        -AdvancePastStopDeadline $true

    if (-not $result.Error -or $result.Error.Exception.Message -notmatch 'Shutdown confirmed: no') {
        throw "Expected actionable replacement timeout, got: $($result.Error.Exception.Message)"
    }
    if ($result.Events -contains 'register' -or $result.Events -contains 'start') {
        throw "Replacement continued after timeout: $($result.Events -join ',')"
    }
    if (-not $result.Task -or $result.Task.Settings.Enabled) {
        throw 'Timed-out replacement did not retain a disabled registration.'
    }
}

# ── Test 14: Full uninstall path fails closed on stop timeout ─────────────────
Assert-Pass '14. Uninstall timeout: does not unregister and stays disabled' {
    $result = Invoke-MockedInstaller `
        -Arguments @{
            Uninstall = $true
            TaskName = 'mock-uninstall-timeout'
        } `
        -StopSucceeds $false `
        -AdvancePastStopDeadline $true

    if (-not $result.Error -or $result.Error.Exception.Message -notmatch 'Shutdown confirmed: no') {
        throw "Expected actionable uninstall timeout, got: $($result.Error.Exception.Message)"
    }
    if ($result.Events -contains 'unregister') {
        throw "Uninstall continued after timeout: $($result.Events -join ',')"
    }
    if (-not $result.Task -or $result.Task.Settings.Enabled) {
        throw 'Timed-out uninstall did not retain a disabled registration.'
    }
}

# ── Test 15: Full replacement changes or removes recurrence ──────────────────
Assert-Pass '15. Replacement success: recurrence is opt-in and omission removes it' {
    $common = @{
        BinaryPath = $PowerShellExecutable
        ConfigDir = (Join-Path ([System.IO.Path]::GetTempPath()) '1mcp-mock-recurrence')
        TaskName = 'mock-recurrence'
        Force = $true
    }

    $enabled = @{} + $common
    $enabled.RecoveryIntervalMinutes = '60'
    $withRecovery = Invoke-MockedInstaller -Arguments $enabled
    if ($withRecovery.Error) {
        throw "Replacement with recurrence failed: $($withRecovery.Error.Exception.Message)"
    }
    if ($withRecovery.Triggers.Count -ne 2 -or
        -not $withRecovery.Triggers[0].AtStartup -or
        -not $withRecovery.Triggers[1].Once -or
        $withRecovery.Triggers[1].RepetitionInterval.TotalMinutes -ne 60) {
        throw 'Replacement did not register AtStartup plus the selected recurrence.'
    }

    $withoutRecovery = Invoke-MockedInstaller -Arguments $common
    if ($withoutRecovery.Error) {
        throw "Replacement without recurrence failed: $($withoutRecovery.Error.Exception.Message)"
    }
    if ($withoutRecovery.Triggers.Count -ne 1 -or -not $withoutRecovery.Triggers[0].AtStartup) {
        throw 'Omitting recurrence did not replace it with AtStartup-only configuration.'
    }
}

# ── Test 16: Full WhatIf path leaves running existing task untouched ─────────
Assert-Pass '16. WhatIf: existing running task remains enabled and unmodified' {
    $result = Invoke-MockedInstaller -Arguments @{
        BinaryPath = $PowerShellExecutable
        ConfigDir = (Join-Path ([System.IO.Path]::GetTempPath()) '1mcp-mock-whatif')
        TaskName = 'mock-whatif'
        Force = $true
        WhatIf = $true
        RecoveryIntervalMinutes = '60'
    }

    if ($result.Error) {
        throw "WhatIf failed: $($result.Error.Exception.Message)"
    }
    foreach ($mutation in @('disable', 'stop', 'register', 'start', 'unregister')) {
        if ($result.Events -contains $mutation) {
            throw "WhatIf performed '$mutation': $($result.Events -join ',')"
        }
    }
    if (-not $result.Task.Settings.Enabled -or $result.RunningInstances -ne 1) {
        throw 'WhatIf changed the existing running task.'
    }
}

# ── Test 17: Initial-start failure leaves the new registration disabled ───────
Assert-Pass '17. Initial start failure: registration is retained disabled' {
    $result = Invoke-MockedInstaller `
        -Arguments @{
            BinaryPath = $PowerShellExecutable
            ConfigDir = (Join-Path ([System.IO.Path]::GetTempPath()) '1mcp-mock-start-failure')
            TaskName = 'mock-start-failure'
            Force = $true
            RecoveryIntervalMinutes = '60'
        } `
        -StartFails $true

    if (-not $result.Error -or $result.Error.Exception.Message -notmatch 'Initial start or state verification failed') {
        throw "Expected initial-start failure, got: $($result.Error.Exception.Message)"
    }
    foreach ($requiredEvent in @('register', 'start', 'disable')) {
        if ($result.Events -notcontains $requiredEvent) {
            throw "Initial-start recovery omitted '$requiredEvent': $($result.Events -join ',')"
        }
    }
    if (-not $result.Task -or $result.Task.Settings.Enabled -or $result.RunningInstances -ne 0) {
        throw 'Initial-start failure did not retain a disabled, stopped registration.'
    }
}

# ── Test 18: Successful uninstall verifies shutdown before removal ────────────
Assert-Pass '18. Uninstall success: disable and stop precede removal' {
    $result = Invoke-MockedInstaller -Arguments @{
        Uninstall = $true
        TaskName = 'mock-uninstall-success'
    }

    if ($result.Error) {
        throw "Successful uninstall failed: $($result.Error.Exception.Message)"
    }
    if (($result.Events -join ',') -ne 'disable,stop,unregister') {
        throw "Unexpected uninstall order: $($result.Events -join ',')"
    }
    if ($result.Task -or $result.RunningInstances -ne 0) {
        throw 'Successful uninstall retained a task or running instance.'
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
