param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'Stop'
$settings = Get-Content (Join-Path $Root 'settings.json') -Raw | ConvertFrom-Json
$evidence = Join-Path $Root 'evidence'
New-Item -ItemType Directory $evidence | Out-Null
$scope = Join-Path $Root 'scope'
New-Item -ItemType Directory $scope | Out-Null
'{"mcpServers":{}}' | Set-Content (Join-Path $scope 'mcp.json')
$env:PATH = (Split-Path $settings.cli) + ';' + $env:PATH
$taskName = $settings.task
$port = 19384
$results = New-Object 'System.Collections.Generic.List[object]'
$startTime = Get-Date
$owner = $null
$step = 'initialization'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Wait-Until {
    param([scriptblock]$Check, [int]$Seconds = 120, [string]$Description)
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if (& $Check) { return }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Timed out: $Description"
}
function Read-Runtime {
    $path = Join-Path $scope 'server.pid'
    if (-not (Test-Path $path)) { return $null }
    try {
        $metadata = Get-Content $path -Raw | ConvertFrom-Json
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($metadata.pid)" -ErrorAction SilentlyContinue
        if (-not $process) { return $null }
        if (-not $process.CommandLine -or -not $process.CommandLine.Contains($Root)) { return $null }
        return [pscustomobject]@{ pid = $metadata.pid; metadata = $metadata;
            executable = $process.ExecutablePath; commandLine = $process.CommandLine;
            creationDate = $process.CreationDate }
    } catch { return $null }
}
function Test-Healthy {
    if (-not (Read-Runtime)) { return $false }
    try {
        $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/health" -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch { return $false }
}
function Get-Instances {
    $service = New-Object -ComObject 'Schedule.Service'
    $service.Connect()
    return [int]$service.GetFolder('\').GetTask($taskName).GetInstances(0).Count
}
function Get-TaskEvents {
    $records = @(Get-WinEvent -FilterHashtable @{
        LogName = 'Microsoft-Windows-TaskScheduler/Operational'; StartTime = $startTime
    } -ErrorAction SilentlyContinue)
    foreach ($record in $records) {
        [xml]$xml = $record.ToXml()
        $data = @{}
        foreach ($item in $xml.Event.EventData.Data) { $data[[string]$item.Name] = [string]$item.'#text' }
        if ($data.TaskName -eq "\$taskName") {
            [pscustomobject]@{ id = $record.Id; time = $record.TimeCreated.ToUniversalTime().ToString('o');
                recordId = $record.RecordId; data = $data }
        }
    }
}
function Get-CompletedActions {
    param([long]$AfterRecordId)
    $events = @(Get-TaskEvents | Where-Object { $_.recordId -gt $AfterRecordId })
    foreach ($start in @($events | Where-Object id -eq 200 | Sort-Object recordId)) {
        $ends = @($events | Where-Object { $_.id -eq 201 -and $_.data.TaskInstanceId -eq $start.data.TaskInstanceId })
        Assert-True ($ends.Count -le 1) 'Duplicate action completion event'
        if ($ends.Count -eq 1) {
            [pscustomobject]@{ instanceId = $start.data.TaskInstanceId; start = $start; completion = $ends[0] }
        }
    }
}
function Assert-IndependentOwner {
    param($Identity, [string]$Metadata)
    $current = Read-Runtime
    Assert-True ([bool]$current) 'Independent owner disappeared during retries'
    Assert-True ($current.pid -eq $Identity.pid -and $current.creationDate -eq $Identity.creationDate) 'Retry displaced the independent owner'
    Assert-True ((Get-Content (Join-Path $scope 'runtime.owner\owner.json') -Raw) -eq $Metadata) 'Retry changed independent ownership metadata'
}
function Save-Snapshot {
    param([string]$Name)
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Export-ScheduledTask -TaskName $taskName | Set-Content (Join-Path $evidence "$Name.xml") -Encoding Unicode
        @{ utc = [DateTime]::UtcNow.ToString('o'); state = [string]$task.State;
           enabled = $task.Settings.Enabled; instances = (Get-Instances);
           runtime = (Read-Runtime); taskInfo = (Get-ScheduledTaskInfo -TaskName $taskName) } |
            ConvertTo-Json -Depth 15 | Set-Content (Join-Path $evidence "$Name.json")
    }
    @(Get-TaskEvents) | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $evidence 'task-history.json')
    if (Test-Path (Join-Path $scope 'logs')) {
        Copy-Item (Join-Path $scope 'logs') (Join-Path $evidence 'runtime-logs') -Recurse -Force
    }
}
function Complete-Step {
    param([string]$Name, [string]$Detail)
    Save-Snapshot $Name
    $results.Add(@{ scenario = $Name; passed = $true; detail = $Detail; utc = [DateTime]::UtcNow.ToString('o') })
    $results | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $evidence 'results.json')
    Write-Host "PASS: $Name - $Detail"
}
# Each missing case records its own result; failure cannot prevent unrelated evidence.
function Invoke-Case {
    param([string]$Name, [scriptblock]$Body)
    $script:step = $Name
    try { & $Body } catch {
        $results.Add(@{ scenario = $Name; passed = $false; error = $_.Exception.Message; utc = [DateTime]::UtcNow.ToString('o') })
        $results | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $evidence 'results.json')
        Save-Snapshot ($Name + '-failed')
        Write-Warning "FAIL: $Name - $($_.Exception.Message)"
    } finally {
        try {
            if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Disable-And-Stop }
        } catch {
            $results.Add(@{ scenario = ($Name + '-cleanup'); passed = $false; error = $_.Exception.Message; utc = [DateTime]::UtcNow.ToString('o') })
            $results | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $evidence 'results.json')
            Write-Warning "FAIL: $Name cleanup - $($_.Exception.Message)"
        }
    }
}
function Invoke-Installer {
    param([hashtable]$Parameters, [string]$Fault = '', [switch]$ExpectFailure)
    $id = [Guid]::NewGuid().ToString('N')
    $request = Join-Path $Root "request-$id.json"
    @{ parameters = $Parameters; fault = $Fault } | ConvertTo-Json -Depth 5 | Set-Content $request
    $out = Join-Path $evidence "installer-$id.stdout.log"
    $err = Join-Path $evidence "installer-$id.stderr.log"
    $child = Start-Process $settings.shellPath -PassThru -WorkingDirectory $Root `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            ('"' + (Join-Path $Root 'temporary-windows-acceptance-driver.ps1') + '"'),
            '-Root', ('"' + $Root + '"'), '-Request', ('"' + $request + '"')) `
        -RedirectStandardOutput $out -RedirectStandardError $err
    $null = $child.Handle
    if (-not $child.WaitForExit(90000)) { $child.Kill(); throw 'Installer exceeded 90 seconds' }
    $child.WaitForExit()
    $output = (Get-Content $out -Raw -ErrorAction SilentlyContinue) + (Get-Content $err -Raw -ErrorAction SilentlyContinue)
    if ($Fault) {
        $marker = $request + '.fault-observed'
        Assert-True ((Test-Path $marker) -and (Get-Content $marker -Raw).Trim() -eq $Fault) "Fault boundary was not executed: $Fault"
        Copy-Item $marker (Join-Path $evidence "installer-$id.fault-observed")
    }
    if ($ExpectFailure) {
        Assert-True ($child.ExitCode -ne 0) 'Expected installer failure'
        Assert-True ($output -match 'Registration remains: yes' -and $output -match 'Task enabled: no' -and $output -match 'Recovery:') 'Failure must report retained disabled registration and recovery'
    } else { Assert-True ($child.ExitCode -eq 0) "Installer failed with exit $($child.ExitCode): $output" }
    return $output
}
function Install-Task {
    param([Nullable[int]]$Interval, [switch]$Force, [switch]$WhatIf, [string]$Fault = '', [switch]$ExpectFailure)
    $parameters = @{ TaskName = $taskName; ConfigDir = $scope; Port = $port; HostAddress = '127.0.0.1' }
    if ($settings.mode -eq 'binary') { $parameters.BinaryPath = $settings.cli } else { $parameters.UseNpm = $true }
    if ($null -ne $Interval) { $parameters.RecoveryIntervalMinutes = [string]$Interval }
    if ($Force) { $parameters.Force = $true }
    if ($WhatIf) { $parameters.WhatIf = $true }
    Invoke-Installer -Parameters $parameters -Fault $Fault -ExpectFailure:$ExpectFailure
}
function Disable-And-Stop {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Stop-ScheduledTask -TaskName $taskName
    Wait-Until { (Get-Instances) -eq 0 -and -not (Read-Runtime) } -Seconds 45 -Description 'disabled shutdown'
}
function Assert-TaskXml {
    param([Nullable[int]]$Interval)
    [xml]$xml = Export-ScheduledTask -TaskName $taskName
    $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    Assert-True ($xml.SelectNodes('/t:Task/t:Triggers/t:BootTrigger', $ns).Count -eq 1) 'Boot trigger missing'
    $timeTriggers = $xml.SelectNodes('/t:Task/t:Triggers/t:TimeTrigger', $ns)
    if ($null -eq $Interval) { Assert-True ($timeTriggers.Count -eq 0) 'Unexpected recurrence' }
    else {
        Assert-True ($timeTriggers.Count -eq 1) 'Recurring trigger missing'
        Assert-True ($timeTriggers[0].Repetition.Interval -eq "PT${Interval}M") 'Wrong recurrence interval'
        Assert-True (-not $timeTriggers[0].Repetition.Duration -and -not $timeTriggers[0].EndBoundary) 'Recurrence must be indefinite'
    }
    Assert-True ($xml.Task.Principals.Principal.LogonType -eq 'Password') 'Not real Password logon'
    Assert-True ((Get-ScheduledTask -TaskName $taskName).Principal.RunLevel -eq 'Limited') 'Wrong effective task privilege level'
    Assert-True ($xml.Task.Principals.Principal.RunLevel -ne 'HighestAvailable') 'Task XML requests elevated runtime'
    Assert-True ($xml.Task.Settings.MultipleInstancesPolicy -eq 'IgnoreNew') 'Wrong duplicate policy'
    Assert-True ($xml.Task.Settings.RestartOnFailure.Count -eq '5' -and $xml.Task.Settings.RestartOnFailure.Interval -eq 'PT2M') 'Production retries changed'
    Assert-True ($xml.Task.Actions.Exec.Arguments -match 'serve --transport http' -and $xml.Task.Actions.Exec.Arguments -notmatch '--background') 'Wrong runtime action'
}
function Start-DirectOwner {
    $args = "serve --transport http --host 127.0.0.1 --port $port --config-dir `"$scope`""
    if ($settings.mode -eq 'binary') { $file = $settings.cli }
    else { $file = 'cmd.exe'; $args = '/d /s /c ""{0}" {1}"' -f $settings.cli, $args }
    return Start-Process $file -ArgumentList $args -PassThru -WorkingDirectory $scope `
        -RedirectStandardOutput (Join-Path $evidence 'owner.stdout.log') `
        -RedirectStandardError (Join-Path $evidence 'owner.stderr.log')
}

function Invoke-RetryDiagnostic {
    param([string]$Name, [bool]$UnifiedEngine, [ValidateSet('demand', 'scheduled')][string]$Launch)
    $script:step = $Name
    $timeline = New-Object 'System.Collections.Generic.List[object]'
    $report = @{ scenario = $Name; diagnosticOnly = $true; unifiedEngine = $UnifiedEngine; launch = $Launch; retryObserved = $false }
    try {
        Disable-And-Stop
        $script:owner = Start-DirectOwner
        Wait-Until { Test-Healthy } -Description "$Name independent owner"
        $identity = Read-Runtime
        $metadata = Get-Content (Join-Path $scope 'runtime.owner\owner.json') -Raw
        Install-Task -Interval 15 -Force | Out-Null
        Assert-TaskXml -Interval 15
        Save-Snapshot ($Name + '-production-definition')
        # Stop only task instances: the independent owner must remain running.
        Disable-ScheduledTask -TaskName $taskName | Out-Null
        Stop-ScheduledTask -TaskName $taskName
        Wait-Until { (Get-Instances) -eq 0 } -Seconds 45 -Description "$Name preparation task stop"
        $task = Get-ScheduledTask -TaskName $taskName
        $task.Settings.UseUnifiedSchedulingEngine = $UnifiedEngine
        $timeTrigger = @($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskTimeTrigger' })
        Assert-True ($timeTrigger.Count -eq 1) 'Diagnostic requires one existing recurrence trigger'
        $boundary = (Get-Date).AddMinutes(15)
        if ($Launch -eq 'scheduled') { $boundary = (Get-Date).AddSeconds(30) }
        $timeTrigger[0].StartBoundary = $boundary.ToString('yyyy-MM-ddTHH:mm:sszzz')
        $diagnosticSecret = Get-Content (Join-Path $Root 'credential.json') -Raw | ConvertFrom-Json
        try {
            Register-ScheduledTask -TaskName $taskName -InputObject $task -User $diagnosticSecret.account -Password $diagnosticSecret.password -Force | Out-Null
        } finally { $diagnosticSecret = $null }
        Assert-TaskXml -Interval 15
        Assert-True ((Get-ScheduledTask -TaskName $taskName).Settings.UseUnifiedSchedulingEngine -eq $UnifiedEngine) 'Diagnostic engine setting did not apply'
        [xml]$appliedXml = Export-ScheduledTask -TaskName $taskName
        $appliedBoundary = [DateTime]::Parse($appliedXml.Task.Triggers.TimeTrigger.StartBoundary).ToUniversalTime()
        Assert-True ([Math]::Abs(($appliedBoundary - $boundary.ToUniversalTime()).TotalSeconds) -lt 1) 'Diagnostic trigger boundary did not apply'
        Save-Snapshot ($Name + '-diagnostic-definition')
        $cursor = [long](@(Get-TaskEvents | Sort-Object recordId -Descending | Select-Object -First 1)[0].recordId)
        $timeline.Add(@{ phase = 'enable'; utc = [DateTime]::UtcNow.ToString('o'); cursor = $cursor; boundary = $boundary.ToUniversalTime().ToString('o') })
        Enable-ScheduledTask -TaskName $taskName | Out-Null
        if ($Launch -eq 'demand') { Start-ScheduledTask -TaskName $taskName }
        Wait-Until {
            Assert-IndependentOwner $identity $metadata
            $pairs = @(Get-CompletedActions $cursor)
            if ($pairs.Count -eq 0) { return $false }
            Assert-True ([long]$pairs[0].completion.data.ResultCode -ne 0) 'Diagnostic initial runtime action exited zero'
            return $true
        } -Seconds 60 -Description "$Name initial correlated nonzero exit"
        $first = @(Get-CompletedActions $cursor)[0]
        $originId = 110
        if ($Launch -eq 'scheduled') { $originId = 107 }
        Wait-Until {
            @(Get-TaskEvents | Where-Object { $_.recordId -gt $cursor -and $_.id -eq $originId -and $_.data.InstanceId -eq $first.instanceId }).Count -eq 1
        } -Seconds 15 -Description "$Name correlated launch origin"
        $report.initial = $first
        $timeline.Add(@{ phase = 'initial-failure-observed'; utc = [DateTime]::UtcNow.ToString('o') })
        $deadline = [DateTime]::UtcNow.AddSeconds(180)
        do {
            Assert-IndependentOwner $identity $metadata
            $starts = @(Get-TaskEvents | Where-Object { $_.recordId -gt $cursor -and $_.id -eq 200 } | Sort-Object recordId)
            if ($starts.Count -gt 1) {
                $report.retryObserved = $true
                $report.secondAction = $starts[1]
                $report.delaySeconds = ([DateTime]::Parse($starts[1].time) - [DateTime]::Parse($first.completion.time)).TotalSeconds
                Wait-Until { @(Get-CompletedActions $cursor).Count -ge 2 } -Seconds 45 -Description "$Name second action completion"
                $report.secondCompletion = @(Get-CompletedActions $cursor)[1].completion
                Assert-True ([long]$report.secondCompletion.data.ResultCode -ne 0) 'Diagnostic retry exited zero'
                break
            }
            Start-Sleep -Seconds 2
        } while ([DateTime]::UtcNow -lt $deadline)
        $report.observationCompleted = $true
        $timeline.Add(@{ phase = 'observation-complete'; utc = [DateTime]::UtcNow.ToString('o'); retryObserved = $report.retryObserved })
        Save-Snapshot ($Name + '-observed')
    } catch {
        $report.error = $_.Exception.Message
        throw
    } finally {
        $taskCleanupConfirmed = $false
        $ownerCleanupConfirmed = $false
        try {
            Disable-ScheduledTask -TaskName $taskName | Out-Null
            Stop-ScheduledTask -TaskName $taskName
            Wait-Until { (Get-Instances) -eq 0 } -Seconds 45 -Description "$Name diagnostic task cleanup"
            $taskCleanupConfirmed = $true
        } finally {
            try {
                if ($script:owner) {
                    & $settings.cli serve --stop --config-dir $scope *> (Join-Path $evidence ($Name + '-owner-stop.log'))
                    Assert-True ($LASTEXITCODE -eq 0) 'Diagnostic owner stop failed'
                    Assert-True ($script:owner.WaitForExit(45000)) 'Diagnostic owner wrapper retained'
                    Wait-Until { -not (Read-Runtime) } -Seconds 15 -Description "$Name owner exit"
                    $script:owner = $null
                }
                $ownerCleanupConfirmed = $true
            } finally {
                $report.cleanupCompleted = $taskCleanupConfirmed -and $ownerCleanupConfirmed
                if ($report.cleanupCompleted) {
                    $timeline.Add(@{ phase = 'cleanup-finished'; utc = [DateTime]::UtcNow.ToString('o') })
                } else {
                    $report.cleanupError = 'Task or owner cleanup was not confirmed; see case failure record'
                    $timeline.Add(@{ phase = 'cleanup-failed'; utc = [DateTime]::UtcNow.ToString('o') })
                }
                $report.timeline = @($timeline.ToArray())
                $report | ConvertTo-Json -Depth 15 | Set-Content (Join-Path $evidence ($Name + '-diagnostic-result.json'))
                Save-Snapshot ($Name + '-final')
            }
        }
    }
    Complete-Step $Name "Diagnostic observation and cleanup completed; retryObserved=$($report.retryObserved); this is not production retry acceptance"
}

function Invoke-NativeLaunchProbe {
    $name = 'native-action-launch-probe'
    $script:step = $name
    $held = Join-Path $Root 'scope-held'
    $moved = $false
    $report = @{ diagnosticOnly = $true; fixtureVerified = $false; fullRetryGatePassed = $false; snapshots = @() }
    function Get-ProbeRuntimeProcesses {
        @(Get-CimInstance Win32_Process | Where-Object {
            $_.Name -in @('node.exe', '1mcp.exe', 'cmd.exe') -and $_.CommandLine -and
            $_.CommandLine.Contains($Root) -and $_.CommandLine.Contains('serve --transport http')
        })
    }
    function Save-ProbeObservation {
        param([string]$Phase, [long]$Cursor)
        $info = Get-ScheduledTaskInfo -TaskName $taskName
        $observation = @{
            phase = $Phase; utc = [DateTime]::UtcNow.ToString('o'); instances = (Get-Instances)
            taskState = [string](Get-ScheduledTask -TaskName $taskName).State
            taskInfo = @{ lastTaskResult = $info.LastTaskResult; lastRunTime = $info.LastRunTime; nextRunTime = $info.NextRunTime; missedRuns = $info.NumberOfMissedRuns }
            scopeExists = (Test-Path $scope); heldScopeExists = (Test-Path $held)
            processes = @(Get-ProbeRuntimeProcesses | Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath, CommandLine)
            events = @(Get-TaskEvents | Where-Object { $_.recordId -gt $Cursor } | Sort-Object recordId)
        }
        $observation | ConvertTo-Json -Depth 15 | Set-Content (Join-Path $evidence ($name + '-' + $Phase + '.json'))
        $report.snapshots += @{ phase = $Phase; utc = $observation.utc }
    }
    try {
        Assert-True (-not (Test-Path $held)) 'Private held scope already exists; refusing to overwrite'
        Install-Task -Interval 15 -Force | Out-Null
        Assert-TaskXml -Interval 15
        Wait-Until { Test-Healthy } -Description 'healthy actual action before native launch probe'
        Disable-And-Stop
        Wait-Until { @(Get-ProbeRuntimeProcesses).Count -eq 0 } -Seconds 45 -Description 'all fixture runtime action processes exited'
        Save-Snapshot ($name + '-original-definition')
        Move-Item -LiteralPath $scope -Destination $held
        $moved = $true
        Assert-True (-not (Test-Path $scope) -and (Test-Path $held)) 'Private scope move did not establish absent working directory'
        $cursor = [long](@(Get-TaskEvents | Sort-Object recordId -Descending | Select-Object -First 1)[0].recordId)
        $report.cursor = $cursor
        Save-ProbeObservation 'baseline' $cursor
        Enable-ScheduledTask -TaskName $taskName | Out-Null
        $launchedAt = [DateTime]::UtcNow
        $report.launchedAt = $launchedAt.ToString('o')
        try { Start-ScheduledTask -TaskName $taskName } catch {
            # Some launch errors may surface synchronously; event evidence still decides classification.
            $report.startRequestError = $_.Exception.Message
        }
        $milestones = @(5, 30, 150, 180)
        $nextMilestone = 0
        $firstFailure = $null
        do {
            $elapsed = ([DateTime]::UtcNow - $launchedAt).TotalSeconds
            $events = @(Get-TaskEvents | Where-Object { $_.recordId -gt $cursor } | Sort-Object recordId)
            $runtimeProcesses = @(Get-ProbeRuntimeProcesses)
            if ((Test-Path $scope) -or $runtimeProcesses.Count -gt 0 -or @($events | Where-Object id -eq 200).Count -gt 0) {
                $report.fixtureInvalid = 'Runtime action started or recreated absent scope; this is not a prelaunch failure fixture'
                Save-ProbeObservation 'fixture-invalid' $cursor
                throw $report.fixtureInvalid
            }
            # Preserve all events; these IDs identify scheduler launch failure, not application exit 201.
            $failures = @($events | Where-Object { $_.id -in @(101, 203) })
            if (-not $firstFailure -and $failures.Count -gt 0) {
                $firstFailure = $failures[0]
                $report.firstLaunchFailure = $firstFailure
                $report.fixtureVerified = $true
                Save-ProbeObservation 'first-launch-failure' $cursor
            }
            if (-not $firstFailure -and $elapsed -ge 45) {
                Save-ProbeObservation 'unclassified-launch' $cursor
                throw 'No known scheduler prelaunch failure observed within 45 seconds; inspect raw events'
            }
            if ($nextMilestone -lt $milestones.Count -and $elapsed -ge $milestones[$nextMilestone]) {
                Save-ProbeObservation ('after-' + $milestones[$nextMilestone] + 's') $cursor
                $nextMilestone++
            }
            if ($elapsed -ge 180) { break }
            Start-Sleep -Seconds 2
        } while ($true)
        $report.launchFailureEvents = @($events | Where-Object { $_.id -in @(101, 203) })
        $report.schedulerRetryEvents = @($events | Where-Object { $_.id -in @(126, 127) })
        # A later failure is a candidate retry only; raw instance/origin evidence must be reviewed.
        $report.laterFailureCandidates = @($report.launchFailureEvents | Where-Object {
            ([DateTime]::Parse($_.time) - [DateTime]::Parse($firstFailure.time)).TotalSeconds -ge 119
        })
        $report.observationCompleted = $true
    } catch {
        $report.error = $_.Exception.Message
        throw
    } finally {
        try {
            Disable-ScheduledTask -TaskName $taskName | Out-Null
            Stop-ScheduledTask -TaskName $taskName
            Wait-Until { (Get-Instances) -eq 0 -and @(Get-ProbeRuntimeProcesses).Count -eq 0 } -Seconds 45 -Description 'verified stopped fixture before restoring scope'
            if ($moved) {
                if (Test-Path $scope) {
                    $unexpected = Join-Path $Root ('scope-unexpected-' + [Guid]::NewGuid().ToString('N'))
                    Move-Item -LiteralPath $scope -Destination $unexpected
                    $report.unexpectedScopePreservedAt = $unexpected
                }
                Move-Item -LiteralPath $held -Destination $scope
                $report.scopeRestored = (Test-Path $scope) -and -not (Test-Path $held)
                Assert-True $report.scopeRestored 'Original private scope restoration failed'
            }
            Assert-True (-not (Get-ScheduledTask -TaskName $taskName).Settings.Enabled) 'Probe task re-enabled during restoration'
            Assert-True ((Get-Instances) -eq 0 -and @(Get-ProbeRuntimeProcesses).Count -eq 0) 'Runtime resumed during restoration'
            $report.cleanupVerified = $true
        } catch {
            $report.cleanupError = $_.Exception.Message
            throw
        } finally {
            $report | ConvertTo-Json -Depth 15 | Set-Content (Join-Path $evidence ($name + '-result.json'))
            Save-Snapshot ($name + '-final')
        }
    }
    Complete-Step $name 'Bounded native launch-failure observation captured and scope restored; full retry exhaustion remains unverified'
}

try {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    Assert-True ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'Installer harness needs elevated token'
    # Keep this already-issued elevated token for installation, but every new task
    # logon is now a standard user. No task action runs as SYSTEM or administrator.
    Remove-LocalGroupMember -Group $settings.adminGroup -Member $settings.account
    $members = @(Get-LocalGroupMember -Group $settings.adminGroup)
    Assert-True (-not ($members | Where-Object Name -eq $settings.account)) 'Task account still administrator'
    & wevtutil sl Microsoft-Windows-TaskScheduler/Operational /e:true
    Assert-True ($LASTEXITCODE -eq 0) 'Task history activation failed'
    @{ settings = $settings; powershell = $PSVersionTable.PSVersion.ToString();
       os = (Get-CimInstance Win32_OperatingSystem).Caption; taskAccountStandardUser = $true;
       runtimeVersion = (& $settings.cli --version); binaryHash = (Get-FileHash $settings.cli).Hash } |
        ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'environment.json')

    $step = 'default-startup-only'
    Install-Task | Out-Null
    Assert-TaskXml
    Wait-Until { Test-Healthy } -Description 'default runtime healthy'
    Complete-Step $step 'Real Password account, foreground action, startup-only XML and healthy runtime'

    if ($settings.scenario -eq 'maintenance') {
    Install-Task -Interval 1 -Force | Out-Null
    Wait-Until { Test-Healthy } -Description 'maintenance baseline healthy'
    Invoke-Case 'preview-non-mutating' {
    $step = 'preview-non-mutating'
    $xmlBefore = Export-ScheduledTask -TaskName $taskName
    $aclBefore = (Get-Acl $scope).Sddl
    $enabledBefore = (Get-ScheduledTask -TaskName $taskName).Settings.Enabled
    Install-Task -Interval 2 -Force -WhatIf | Out-Null
    Assert-True ((Export-ScheduledTask -TaskName $taskName) -eq $xmlBefore) 'Preview changed XML'
    Assert-True ((Get-Acl $scope).Sddl -eq $aclBefore) 'Preview changed ACL'
    Assert-True ((Get-ScheduledTask -TaskName $taskName).Settings.Enabled -eq $enabledBefore) 'Preview changed task state'
    Complete-Step $step 'Preview preserved real task XML, state and config ACL'

    }

    foreach ($operation in @('replacement', 'uninstall')) {
    foreach ($fault in @('stop-error', 'stop-timeout')) {
        Invoke-Case "maintenance-$operation-$fault" {
        $step = "maintenance-$operation-$fault"
        Install-Task -Interval 1 -Force | Out-Null
        Wait-Until { Test-Healthy } -Description 'runtime before injected maintenance fault'
        if ($operation -eq 'uninstall') {
            $output = Invoke-Installer -Parameters @{ TaskName = $taskName; Uninstall = $true } -Fault $fault -ExpectFailure
        } else {
            $output = Install-Task -Interval 2 -Force -Fault $fault -ExpectFailure
        }
        Assert-True (-not (Get-ScheduledTask -TaskName $taskName).Settings.Enabled) 'Failed maintenance re-enabled task'
        Assert-True ((Get-Instances) -eq 1) 'Controlled stop fault did not retain real live instance'
        Assert-True ($output -match 'Shutdown confirmed: no') 'Stop fault misreported shutdown'
        Disable-And-Stop
        Start-Sleep -Seconds 65
        Assert-True ((Get-Instances) -eq 0 -and -not (Read-Runtime)) 'Faulted maintenance resumed across recurrence'
        Complete-Step $step 'Controlled cmdlet fault against real task blocked replacement and retained disabled registration; no recurrence'
        }
    }

    }

    Invoke-Case 'failed-registration-retained-disabled' {
    $step = 'failed-registration-retained-disabled'
    Install-Task -Interval 1 -Force | Out-Null
    Wait-Until { Test-Healthy } -Description 'runtime before registration fault'
    Install-Task -Interval 2 -Force -Fault 'registration-error' -ExpectFailure | Out-Null
    Assert-True (-not (Get-ScheduledTask -TaskName $taskName).Settings.Enabled) 'Registration failure restored execution'
    Wait-Until { (Get-Instances) -eq 0 -and -not (Read-Runtime) } -Seconds 45 -Description 'old runtime stopped before registration fault'
    Start-Sleep -Seconds 65
    Assert-True ((Get-Instances) -eq 0 -and -not (Read-Runtime)) 'Failed replacement relaunched'
    Complete-Step $step 'Injected registration error after real disable/stop retained disabled task across recurrence'

    }

    Invoke-Case 'failed-uninstall-retained-disabled' {
    $step = 'failed-uninstall-retained-disabled'
    Install-Task -Interval 1 -Force | Out-Null
    Wait-Until { Test-Healthy } -Description 'runtime before removal fault'
    Invoke-Installer -Parameters @{ TaskName = $taskName; Uninstall = $true } -Fault 'removal-error' -ExpectFailure | Out-Null
    Assert-True (-not (Get-ScheduledTask -TaskName $taskName).Settings.Enabled) 'Removal failure restored execution'
    Wait-Until { (Get-Instances) -eq 0 -and -not (Read-Runtime) } -Seconds 45 -Description 'old runtime stopped before removal fault'
    Start-Sleep -Seconds 65
    Assert-True ((Get-Instances) -eq 0 -and -not (Read-Runtime)) 'Failed uninstall relaunched'
    Complete-Step $step 'Injected unregister error after real disable/stop retained disabled task across recurrence'

    }

    Invoke-Case 'replacement-remove-recurrence' {
    $step = 'replacement-remove-recurrence'
    Install-Task -Force | Out-Null
    Assert-TaskXml
    Wait-Until { Test-Healthy } -Description 'startup-only replacement runtime'
    Complete-Step $step 'Omitting interval removed previously configured recurrence'

    }

    }
    if ($settings.scenario -eq 'retries') {
    $step = 'exhausted-retries-and-recurrence'
    Disable-And-Stop
    $owner = Start-DirectOwner
    Wait-Until { Test-Healthy } -Description 'independent owner for natural retry failures'
    $retryOwnerIdentity = Read-Runtime
    $retryOwnerMetadata = Get-Content (Join-Path $scope 'runtime.owner\owner.json') -Raw
    $historyCursor = [long](@(Get-TaskEvents | Sort-Object recordId -Descending | Select-Object -First 1)[0].recordId)
    Install-Task -Interval 15 -Force | Out-Null
    Assert-TaskXml -Interval 15
    [xml]$failureXml = Export-ScheduledTask -TaskName $taskName
    $firstRecurrence = [DateTime]::Parse($failureXml.Task.Triggers.TimeTrigger.StartBoundary).ToUniversalTime()
    # Real ownership refusal exits nonzero. COM idle can precede event publication.
    Wait-Until {
        Assert-IndependentOwner $retryOwnerIdentity $retryOwnerMetadata
        $pairs = @(Get-CompletedActions $historyCursor)
        if ($pairs.Count -eq 0) { return $false }
        Assert-True ([long]$pairs[0].completion.data.ResultCode -ne 0) 'Initial ownership refusal exited zero'
        return $true
    } -Seconds 45 -Description 'correlated natural runtime failure'
    Wait-Until {
        Assert-IndependentOwner $retryOwnerIdentity $retryOwnerMetadata
        $pairs = @(Get-CompletedActions $historyCursor)
        Assert-True ($pairs.Count -le 6) 'More than five retries occurred'
        foreach ($pair in $pairs) { Assert-True ([long]$pair.completion.data.ResultCode -ne 0) 'Retry exited zero' }
        return $pairs.Count -eq 6 -and (Get-Instances) -eq 0
    } -Seconds 760 -Description 'initial failure plus five real two-minute retries'
    $retryPairs = @(Get-CompletedActions $historyCursor)
    Assert-True (@($retryPairs.instanceId | Select-Object -Unique).Count -eq 6) 'Retry instance IDs were reused'
    for ($attempt = 1; $attempt -lt 6; $attempt++) {
        $previousEnd = [DateTime]::Parse($retryPairs[$attempt - 1].completion.time).ToUniversalTime()
        $nextStart = [DateTime]::Parse($retryPairs[$attempt].start.time).ToUniversalTime()
        $delay = ($nextStart - $previousEnd).TotalSeconds
        # Allow one second of event-accounting skew and 30 seconds scheduling delay.
        Assert-True ($delay -ge 119 -and $delay -le 150) "Retry $attempt interval was $delay seconds"
    }
    $retryPairs | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $evidence 'retry-action-pairs.json')
    Assert-True ([DateTime]::UtcNow.AddSeconds(150) -lt $firstRecurrence) 'Insufficient idle observation time before recurrence'
    Save-Snapshot 'retries-exhausted'
    $idleUntil = [DateTime]::UtcNow.AddSeconds(150)
    while ([DateTime]::UtcNow -lt $idleUntil) {
        Assert-IndependentOwner $retryOwnerIdentity $retryOwnerMetadata
        $starts = @(Get-TaskEvents | Where-Object { $_.id -eq 200 -and $_.recordId -gt $historyCursor })
        Assert-True ($starts.Count -eq 6 -and (Get-Instances) -eq 0) 'Task launched during retry-exhaustion idle observation'
        Start-Sleep -Seconds 2
    }
    Save-Snapshot 'retry-exhaustion-idle'
    & $settings.cli serve --stop --config-dir $scope *> (Join-Path $evidence 'retry-owner-stop.log')
    Assert-True ($LASTEXITCODE -eq 0) 'Independent owner clean stop failed'
    Assert-True ($owner.WaitForExit(45000)) 'Independent owner wrapper retained'
    Wait-Until { -not (Read-Runtime) } -Seconds 15 -Description 'independent owner runtime exit'
    $owner = $null
    Wait-Until {
        $events = @(Get-TaskEvents | Where-Object { $_.recordId -gt $historyCursor })
        $starts = @($events | Where-Object id -eq 200 | Sort-Object recordId)
        Assert-True ($starts.Count -le 7) 'Unexpected extra action after exhaustion'
        if ($starts.Count -lt 7) {
            Assert-True ((Get-Instances) -eq 0 -or [DateTime]::UtcNow -ge $firstRecurrence) 'Task became running before recurrence'
            return $false
        }
        $recoveryStart = $starts[6]
        Assert-True ([DateTime]::Parse($recoveryStart.time).ToUniversalTime() -ge $firstRecurrence) 'Seventh action started before recurrence'
        $trigger = @($events | Where-Object { $_.id -eq 107 -and $_.data.InstanceId -eq $recoveryStart.data.TaskInstanceId })
        if ($trigger.Count -eq 0) { return $false }
        Assert-True ($trigger.Count -eq 1) 'Recovery requires one correlated scheduled trigger'
        Assert-True ([DateTime]::Parse($trigger[0].time).ToUniversalTime() -ge $firstRecurrence) 'Recovery trigger predates recurrence'
        if (-not (Test-Healthy)) { return $false }
        Assert-True ((Get-Instances) -eq 1) 'Recovery must have exactly one scheduled instance'
        $recovered = Read-Runtime
        Assert-True ($recovered.pid -ne $retryOwnerIdentity.pid -or $recovered.creationDate -ne $retryOwnerIdentity.creationDate) 'Recovery retained independent owner identity'
        @{ trigger = $trigger[0]; action = $recoveryStart; runtime = $recovered } |
            ConvertTo-Json -Depth 12 | Set-Content (Join-Path $evidence 'recurrence-after-retries.json')
        return $true
    } -Seconds 420 -Description 'separate recurrence and healthy new runtime after exhausted retries'
    Complete-Step $step 'Six correlated nonzero exits at measured two-minute intervals, 150 seconds idle, then separate scheduled recurrence recovered'

    }
    if ($settings.scenario -eq 'diagnostic') {
        Invoke-Case 'diagnostic-unified-scheduled' { Invoke-RetryDiagnostic 'diagnostic-unified-scheduled' $true 'scheduled' }
        Invoke-Case 'diagnostic-legacy-demand' { Invoke-RetryDiagnostic 'diagnostic-legacy-demand' $false 'demand' }
        Invoke-Case 'diagnostic-legacy-scheduled' { Invoke-RetryDiagnostic 'diagnostic-legacy-scheduled' $false 'scheduled' }
    }
    if ($settings.scenario -eq 'native-probe') {
        Invoke-Case 'native-action-launch-probe' { Invoke-NativeLaunchProbe }
    }
    if ($settings.scenario -ne 'native-probe') {
    Invoke-Case 'successful-uninstall' {
    Install-Task -Force | Out-Null
    Wait-Until { Test-Healthy } -Description 'runtime before successful uninstall'
    $step = 'successful-uninstall'
    Invoke-Installer -Parameters @{ TaskName = $taskName; Uninstall = $true } | Out-Null
    Assert-True (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) 'Successful uninstall retained task'
    Assert-True (-not (Read-Runtime)) 'Successful uninstall retained runtime'
    Complete-Step $step 'Uninstall removed real registration after bounded shutdown'
    }
    }
    if (@($results | Where-Object { -not $_.passed }).Count -gt 0) {
        $step = 'independent-case-summary'
        throw 'One or more independent acceptance cases failed; see results.json'
    }
} catch {
    $results.Add(@{ scenario = $step; passed = $false; error = $_.Exception.Message; utc = [DateTime]::UtcNow.ToString('o') })
    $results | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $evidence 'results.json')
    throw
} finally {
    Save-Snapshot 'final'
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Disable-ScheduledTask -TaskName $taskName | Out-Null
        Stop-ScheduledTask -TaskName $taskName
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
}
