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
$listener = $null
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
function Stop-Cleanly {
    & $settings.cli serve --stop --config-dir $scope *> (Join-Path $evidence 'clean-stop.log')
    Assert-True ($LASTEXITCODE -eq 0) 'Cooperative clean stop failed'
    Wait-Until { (Get-Instances) -eq 0 -and -not (Read-Runtime) } -Seconds 45 -Description 'clean shutdown'
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

    $step = 'exhausted-retries-and-recurrence'
    Disable-And-Stop
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
    $listener.Start()
    $failureStart = Get-Date
    Install-Task -Interval 15 -Force | Out-Null
    Assert-TaskXml -Interval 15
    [xml]$failureXml = Export-ScheduledTask -TaskName $taskName
    $firstRecurrence = [DateTime]::Parse($failureXml.Task.Triggers.TimeTrigger.StartBoundary)
    Wait-Until {
        $failed = @(Get-TaskEvents | Where-Object { $_.id -eq 201 -and [DateTime]::Parse($_.time) -ge $failureStart -and [long]$_.data.ResultCode -ne 0 })
        $failed.Count -eq 6 -and (Get-Instances) -eq 0
    } -Seconds 760 -Description 'initial failure plus all five real two-minute retries'
    Assert-True ((Get-Date) -lt $firstRecurrence) 'Retries did not exhaust before first recurrence'
    Save-Snapshot 'retries-exhausted'
    Start-Sleep -Seconds 30
    $failedStarts = @(Get-TaskEvents | Where-Object { $_.id -eq 200 -and [DateTime]::Parse($_.time) -ge $failureStart })
    Assert-True ($failedStarts.Count -eq 6 -and (Get-Instances) -eq 0) 'Immediate retries not exhausted'
    $listener.Stop(); $listener = $null
    Wait-Until { Test-Healthy } -Seconds 420 -Description 'real scheduled recurrence after retry exhaustion'
    Assert-True ((Get-Date) -ge $firstRecurrence) 'Recovery happened before scheduled recurrence'
    Complete-Step $step 'Six failed actions at production retry settings, idle after exhaustion, then scheduled healthy runtime'

    $step = 'replacement-change-to-one-minute'
    Install-Task -Interval 1 -Force | Out-Null
    Assert-TaskXml -Interval 1
    Wait-Until { Test-Healthy } -Description 'replacement runtime healthy'
    Complete-Step $step 'Real disable/stop/replacement changed recurrence to one minute'

    $step = 'clean-exit-recurrence'
    $oldPid = (Read-Runtime).pid
    $cleanStart = Get-Date
    Stop-Cleanly
    Wait-Until {
        @(Get-TaskEvents | Where-Object { $_.id -eq 201 -and [DateTime]::Parse($_.time) -ge $cleanStart -and [long]$_.data.ResultCode -eq 0 }).Count -ge 1
    } -Seconds 15 -Description 'Task Scheduler records clean action exit'
    Wait-Until { (Test-Healthy) -and (Read-Runtime).pid -ne $oldPid } -Seconds 150 -Description 'recurrence after clean exit'
    Complete-Step $step 'Cooperative serve --stop completed; enabled task later launched a new healthy runtime'

    $step = 'manual-stop-recurrence'
    $oldPid = (Read-Runtime).pid
    Stop-ScheduledTask -TaskName $taskName
    Wait-Until { (Get-Instances) -eq 0 -and -not (Read-Runtime) } -Seconds 45 -Description 'manual task stop'
    Wait-Until { (Test-Healthy) -and (Read-Runtime).pid -ne $oldPid } -Seconds 150 -Description 'recurrence after manual stop'
    Complete-Step $step 'Stop-ScheduledTask completed; enabled task later launched a new healthy runtime'

    $step = 'ignore-new-across-recurrence'
    $stable = Read-Runtime
    $until = (Get-Date).AddSeconds(75)
    do {
        Assert-True ((Get-Instances) -eq 1) 'Unexpected duplicate task instance'
        Assert-True ((Read-Runtime).pid -eq $stable.pid) 'Running runtime changed across recurrence'
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $until)
    Complete-Step $step 'Same process identity and exactly one COM task instance across recurrence'

    $step = 'disabled-across-recurrence'
    Disable-And-Stop
    $startsBefore = @(Get-TaskEvents | Where-Object id -eq 200).Count
    Start-Sleep -Seconds 75
    Assert-True ((Get-Instances) -eq 0 -and -not (Read-Runtime)) 'Disabled task relaunched'
    Assert-True (@(Get-TaskEvents | Where-Object id -eq 200).Count -eq $startsBefore) 'Disabled task launched an action'
    Complete-Step $step 'Disabled task stayed stopped across a full recurrence boundary'

    $step = 'runtime-scope-owner-refusal'
    $owner = Start-DirectOwner
    Wait-Until { Test-Healthy } -Description 'independent foreground owner'
    $ownerIdentity = Read-Runtime
    $ownerMetadata = Get-Content (Join-Path $scope 'runtime.owner\owner.json') -Raw
    $before = @(Get-TaskEvents | Where-Object id -eq 200).Count
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    Wait-Until { @(Get-TaskEvents | Where-Object id -eq 200).Count -gt $before } -Seconds 150 -Description 'scheduled launch against owned scope'
    Wait-Until { (Get-Instances) -eq 0 } -Seconds 45 -Description 'scheduled ownership refusal'
    $runtimeLog = Get-Content (Join-Path $scope 'logs\server.log') -Raw
    Assert-True ($runtimeLog -match 'Runtime Scope is already owned') 'Missing runtime ownership refusal evidence'
    Assert-True ((Read-Runtime).pid -eq $ownerIdentity.pid) 'Scheduled task displaced the independent owner'
    Assert-True ((Get-Content (Join-Path $scope 'runtime.owner\owner.json') -Raw) -eq $ownerMetadata) 'Scheduled task changed ownership metadata'
    Assert-True (Test-Healthy) 'Independent owner lost health'
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    & $settings.cli serve --stop --config-dir $scope *> (Join-Path $evidence 'owner-stop.log')
    Assert-True ($LASTEXITCODE -eq 0) 'Independent owner clean stop failed'
    Assert-True ($owner.WaitForExit(45000)) 'Independent owner process retained'
    $owner = $null
    Complete-Step $step 'Scheduled recurrence refused a separately launched owner without changing its PID or ownership metadata'

    $step = 'preview-non-mutating'
    $xmlBefore = Export-ScheduledTask -TaskName $taskName
    $aclBefore = (Get-Acl $scope).Sddl
    $enabledBefore = (Get-ScheduledTask -TaskName $taskName).Settings.Enabled
    Install-Task -Interval 2 -Force -WhatIf | Out-Null
    Assert-True ((Export-ScheduledTask -TaskName $taskName) -eq $xmlBefore) 'Preview changed XML'
    Assert-True ((Get-Acl $scope).Sddl -eq $aclBefore) 'Preview changed ACL'
    Assert-True ((Get-ScheduledTask -TaskName $taskName).Settings.Enabled -eq $enabledBefore) 'Preview changed task state'
    Complete-Step $step 'Preview preserved real task XML, state and config ACL'

    foreach ($fault in @('stop-error', 'stop-timeout')) {
        $step = "maintenance-$fault"
        Install-Task -Interval 1 -Force | Out-Null
        Wait-Until { Test-Healthy } -Description 'runtime before injected maintenance fault'
        $output = Install-Task -Interval 2 -Force -Fault $fault -ExpectFailure
        Assert-True (-not (Get-ScheduledTask -TaskName $taskName).Settings.Enabled) 'Failed maintenance re-enabled task'
        Assert-True ((Get-Instances) -eq 1) 'Controlled stop fault did not retain real live instance'
        Assert-True ($output -match 'Shutdown confirmed: no') 'Stop fault misreported shutdown'
        Disable-And-Stop
        Start-Sleep -Seconds 65
        Assert-True ((Get-Instances) -eq 0 -and -not (Read-Runtime)) 'Faulted maintenance resumed across recurrence'
        Complete-Step $step 'Controlled cmdlet fault against real task blocked replacement and retained disabled registration; no recurrence'
    }

    $step = 'failed-registration-retained-disabled'
    Install-Task -Interval 1 -Force | Out-Null
    Wait-Until { Test-Healthy } -Description 'runtime before registration fault'
    Install-Task -Interval 2 -Force -Fault 'registration-error' -ExpectFailure | Out-Null
    Assert-True (-not (Get-ScheduledTask -TaskName $taskName).Settings.Enabled) 'Registration failure restored execution'
    Wait-Until { (Get-Instances) -eq 0 -and -not (Read-Runtime) } -Seconds 45 -Description 'old runtime stopped before registration fault'
    Start-Sleep -Seconds 65
    Assert-True ((Get-Instances) -eq 0 -and -not (Read-Runtime)) 'Failed replacement relaunched'
    Complete-Step $step 'Injected registration error after real disable/stop retained disabled task across recurrence'

    $step = 'failed-uninstall-retained-disabled'
    Install-Task -Interval 1 -Force | Out-Null
    Wait-Until { Test-Healthy } -Description 'runtime before removal fault'
    Invoke-Installer -Parameters @{ TaskName = $taskName; Uninstall = $true } -Fault 'removal-error' -ExpectFailure | Out-Null
    Assert-True (-not (Get-ScheduledTask -TaskName $taskName).Settings.Enabled) 'Removal failure restored execution'
    Wait-Until { (Get-Instances) -eq 0 -and -not (Read-Runtime) } -Seconds 45 -Description 'old runtime stopped before removal fault'
    Start-Sleep -Seconds 65
    Assert-True ((Get-Instances) -eq 0 -and -not (Read-Runtime)) 'Failed uninstall relaunched'
    Complete-Step $step 'Injected unregister error after real disable/stop retained disabled task across recurrence'

    $step = 'replacement-remove-recurrence'
    Install-Task -Force | Out-Null
    Assert-TaskXml
    Wait-Until { Test-Healthy } -Description 'startup-only replacement runtime'
    Complete-Step $step 'Omitting interval removed previously configured recurrence'

    $step = 'successful-uninstall'
    Invoke-Installer -Parameters @{ TaskName = $taskName; Uninstall = $true } | Out-Null
    Assert-True (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) 'Successful uninstall retained task'
    Assert-True (-not (Read-Runtime)) 'Successful uninstall retained runtime'
    Complete-Step $step 'Uninstall removed real registration after bounded shutdown'
} catch {
    $results.Add(@{ scenario = $step; passed = $false; error = $_.Exception.Message; utc = [DateTime]::UtcNow.ToString('o') })
    $results | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $evidence 'results.json')
    throw
} finally {
    if ($listener) { $listener.Stop() }
    Save-Snapshot 'final'
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Disable-ScheduledTask -TaskName $taskName | Out-Null
        Stop-ScheduledTask -TaskName $taskName
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
}
