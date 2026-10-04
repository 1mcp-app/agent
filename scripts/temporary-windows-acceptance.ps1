param(
    [ValidateSet('binary', 'npm')][string]$Mode,
    [ValidateSet('powershell', 'pwsh')][string]$Shell,
    [switch]$CleanupOnly
)
$ErrorActionPreference = 'Stop'
$evidence = Join-Path $PWD 'acceptance-evidence'
New-Item -ItemType Directory -Force $evidence | Out-Null
$statePath = Join-Path $evidence 'cleanup-state.json'

function Clear-AcceptanceResources {
    if (-not (Test-Path $statePath)) { return }
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    if ($state.root -notmatch '^C:\\1mcp-acceptance-[a-f0-9]{12}$' -or
        $state.user -notmatch '^mcpa[a-f0-9]{12}$' -or
        $state.task -notmatch '^1mcp-acceptance-[a-f0-9]{12}$') {
        throw 'Refusing cleanup outside the recorded acceptance namespace'
    }
    $task = Get-ScheduledTask -TaskName $state.task -ErrorAction SilentlyContinue
    if ($task) {
        Disable-ScheduledTask -TaskName $state.task | Out-Null
        Stop-ScheduledTask -TaskName $state.task
        Unregister-ScheduledTask -TaskName $state.task -Confirm:$false
    }
    # Match the exact private root in executable/arguments; never trust stored PIDs.
    $owned = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -ne $PID -and
        (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($state.root + '\', [StringComparison]::OrdinalIgnoreCase)) -or
         ($_.CommandLine -and $_.CommandLine.Contains($state.root)))
    })
    foreach ($process in $owned) { Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null }
    Start-Sleep -Seconds 2
    if (Get-ScheduledTask -TaskName $state.task -ErrorAction SilentlyContinue) { throw 'Acceptance task retained' }
    $remaining = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($state.root)
    })
    if ($remaining.Count -gt 0) { throw 'Acceptance processes retained' }
    $localUser = Get-LocalUser -Name $state.user -ErrorAction SilentlyContinue
    if ($localUser) {
        $userSid = $localUser.SID.Value
        $profile = Get-CimInstance Win32_UserProfile -Filter "SID='$userSid'"
        if ($profile) { Remove-CimInstance -InputObject $profile }
        if (Get-CimInstance Win32_UserProfile -Filter "SID='$userSid'") { throw 'Acceptance profile retained' }
        Remove-LocalUser -Name $state.user
    }
    if (Get-LocalUser -Name $state.user -ErrorAction SilentlyContinue) { throw 'Acceptance user retained' }
    if (Test-Path $state.root) { Remove-Item $state.root -Recurse -Force }
    if (Test-Path $state.root) { throw 'Acceptance files retained' }
    @{ completedUtc = [DateTime]::UtcNow.ToString('o'); taskRemoved = $true;
       processesRemoved = $true; userRemoved = $true; profileRemoved = $true; filesRemoved = $true } |
        ConvertTo-Json | Set-Content (Join-Path $evidence 'cleanup.json')
}

if ($CleanupOnly) { Clear-AcceptanceResources; exit 0 }
$id = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$root = "C:\1mcp-acceptance-$id"
$user = "mcpa$id"
$taskName = "1mcp-acceptance-$id"
@{ root = $root; user = $user; task = $taskName } | ConvertTo-Json | Set-Content $statePath
$child = $null
try {
    New-Item -ItemType Directory $root | Out-Null
    $password = 'Aa1!' + [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $secure = ConvertTo-SecureString $password -AsPlainText -Force
    New-LocalUser -Name $user -Password $secure -AccountNeverExpires -PasswordNeverExpires | Out-Null
    $adminGroup = (Get-LocalGroup -SID 'S-1-5-32-544').Name
    Add-LocalGroupMember -Group $adminGroup -Member $user
    $account = "$env:COMPUTERNAME\$user"
    # Remove inheritance before putting the ephemeral credential on disk.
    & icacls $root /inheritance:r /grant:r "${account}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Private fixture ACL failed' }
    @{ account = $account; password = $password } | ConvertTo-Json | Set-Content (Join-Path $root 'credential.json')
    Copy-Item ./scripts/install-windows-task.ps1 $root
    Copy-Item ./scripts/temporary-windows-acceptance-driver.ps1 $root
    Copy-Item ./scripts/temporary-windows-acceptance-worker.ps1 $root
    $shellPath = (Get-Command "$Shell.exe").Source
    $nodePath = (Get-Command node.exe).Source
    if ($Mode -eq 'binary') {
        Copy-Item ./1mcp.exe $root
        $cli = Join-Path $root '1mcp.exe'
    } else {
        $prefix = Join-Path $root 'npm'
        $package = Get-ChildItem $env:RUNNER_TEMP -Filter '*1mcp*agent*.tgz' | Select-Object -First 1
        if (-not $package) { throw 'Exact-head npm package not found' }
        npm install --global --prefix $prefix --ignore-scripts $package.FullName
        if ($LASTEXITCODE -ne 0) { throw 'Exact-head npm installation failed' }
        # npm's real generated shim resolves this node.exe before machine PATH.
        Copy-Item $nodePath (Join-Path $prefix 'node.exe')
        $cli = Join-Path $prefix '1mcp.cmd'
    }
    @{ mode = $Mode; shell = $Shell; shellPath = $shellPath; cli = $cli;
       task = $taskName; root = $root; account = $account; adminGroup = $adminGroup;
       sourceSha = $env:GITHUB_SHA; nodeVersion = (& $nodePath --version) } |
        ConvertTo-Json | Set-Content (Join-Path $root 'settings.json')
    $credential = New-Object System.Management.Automation.PSCredential($account, $secure)
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        ('"' + (Join-Path $root 'temporary-windows-acceptance-worker.ps1') + '"'), '-Root', ('"' + $root + '"'))
    $child = Start-Process -FilePath $shellPath -Credential $credential -LoadUserProfile `
        -WorkingDirectory $root -ArgumentList $arguments -PassThru `
        -RedirectStandardOutput (Join-Path $root 'worker.stdout.log') `
        -RedirectStandardError (Join-Path $root 'worker.stderr.log')
    $deadline = (Get-Date).AddMinutes(40)
    while (-not $child.HasExited -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 15
        $child.Refresh()
        Write-Host "Acceptance worker running: $Mode / $Shell / $([DateTime]::UtcNow.ToString('o'))"
    }
    if (-not $child.HasExited) { throw 'Acceptance worker exceeded 40-minute bound' }
    if ($child.ExitCode -ne 0) { throw "Acceptance worker failed with exit $($child.ExitCode); see evidence" }
} finally {
    if (Test-Path (Join-Path $root 'evidence')) {
        Copy-Item (Join-Path $root 'evidence\*') $evidence -Recurse -Force
    }
    foreach ($name in @('worker.stdout.log', 'worker.stderr.log')) {
        if (Test-Path (Join-Path $root $name)) { Copy-Item (Join-Path $root $name) $evidence }
    }
    Clear-AcceptanceResources
}
