param(
    [ValidateSet('binary', 'npm')][string]$Mode,
    [ValidateSet('powershell', 'pwsh')][string]$Shell,
    [ValidateSet('maintenance', 'retries')][string]$Scenario,
    [switch]$CleanupOnly
)
$ErrorActionPreference = 'Stop'
$evidence = Join-Path $PWD 'acceptance-evidence'
New-Item -ItemType Directory -Force $evidence | Out-Null
$statePath = Join-Path $evidence 'cleanup-state.json'

# Assign only this disposable account's batch-logon right; never replace machine policy.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class AcceptanceAccountRights {
    [StructLayout(LayoutKind.Sequential)] struct Attributes {
        public uint Length; public IntPtr RootDirectory, ObjectName;
        public uint Flags; public IntPtr SecurityDescriptor, SecurityQualityOfService;
    }
    [StructLayout(LayoutKind.Sequential)] struct UnicodeString {
        public ushort Length, MaximumLength; public IntPtr Buffer;
    }
    [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system, ref Attributes attributes, uint access, out IntPtr handle);
    [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr handle, IntPtr sid, ref UnicodeString rights, uint count);
    [DllImport("advapi32.dll")] static extern uint LsaRemoveAccountRights(IntPtr handle, IntPtr sid, byte all, ref UnicodeString rights, uint count);
    [DllImport("advapi32.dll")] static extern uint LsaNtStatusToWinError(uint status);
    [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr handle);
    public static void SetBatchLogon(string sidString, bool grant) {
        var sid = new SecurityIdentifier(sidString);
        var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
        var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        IntPtr handle = IntPtr.Zero, buffer = Marshal.StringToHGlobalUni("SeBatchLogonRight");
        try {
            var attributes = new Attributes(); attributes.Length = (uint)Marshal.SizeOf(typeof(Attributes));
            uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x810, out handle);
            if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
            var length = (ushort)("SeBatchLogonRight".Length * 2);
            var right = new UnicodeString { Length = length, MaximumLength = (ushort)(length + 2), Buffer = buffer };
            status = grant ? LsaAddAccountRights(handle, pin.AddrOfPinnedObject(), ref right, 1)
                : LsaRemoveAccountRights(handle, pin.AddrOfPinnedObject(), 0, ref right, 1);
            if (status != 0 && !(status == 0xc0000034 && !grant))
                throw new Win32Exception((int)LsaNtStatusToWinError(status));
        } finally { if (handle != IntPtr.Zero) LsaClose(handle); Marshal.FreeHGlobal(buffer); pin.Free(); }
    }
}
'@

function Clear-AcceptanceResources {
    if (-not (Test-Path $statePath)) { return }
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    if ($state.root -notmatch '^C:\\1mcp-acceptance-[a-f0-9]{12}$' -or
        $state.user -notmatch '^mcpa[a-f0-9]{12}$' -or
        $state.task -notmatch '^1mcp-acceptance-[a-f0-9]{12}$') {
        throw 'Refusing cleanup outside the recorded acceptance namespace'
    }
    foreach ($name in @($state.task, ($state.task + '-bootstrap'))) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($task) {
            Disable-ScheduledTask -TaskName $name | Out-Null
            Stop-ScheduledTask -TaskName $name
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
        }
    }
    # Match the private root, plus every process belonging to this disposable SID.
    # CIM providers can hold the account profile without mentioning the fixture path.
    $localUser = Get-LocalUser -Name $state.user -ErrorAction SilentlyContinue
    $userSid = $state.sid
    if ($localUser) { $userSid = $localUser.SID.Value }
    function Get-FixtureProcesses {
        foreach ($process in Get-CimInstance Win32_Process) {
            if ($process.ProcessId -eq $PID) { continue }
            $matched = ($process.ExecutablePath -and $process.ExecutablePath.StartsWith($state.root + '\', [StringComparison]::OrdinalIgnoreCase)) -or
                ($process.CommandLine -and $process.CommandLine.Contains($state.root))
            if (-not $matched -and $userSid) {
                try {
                    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop
                    $matched = $owner.ReturnValue -eq 0 -and $owner.Sid -eq $userSid
                } catch { }
            }
            if ($matched) { $process }
        }
    }
    $owned = @(Get-FixtureProcesses)
    $owned | Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine |
        ConvertTo-Json | Set-Content (Join-Path $evidence 'cleanup-processes.json')
    foreach ($process in $owned) { Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null }
    Start-Sleep -Seconds 5
    foreach ($name in @($state.task, ($state.task + '-bootstrap'))) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw 'Acceptance task retained' }
    }
    if (@(Get-FixtureProcesses).Count -gt 0) { throw 'Acceptance account processes retained' }
    $localUser = Get-LocalUser -Name $state.user -ErrorAction SilentlyContinue
    $userSid = $state.sid
    if ($localUser) { $userSid = $localUser.SID.Value }
    $profileRemoved = $true
    $rightsRemoved = $true
    if ($userSid) {
        try { [AcceptanceAccountRights]::SetBatchLogon($userSid, $false) } catch { $rightsRemoved = $false }
        # Release only this test user's registry hives after all of its processes
        # and tasks have ended. Never unload a shared or unrelated user profile.
        foreach ($hive in @(($userSid + '_Classes'), $userSid)) {
            if (Test-Path ("Registry::HKEY_USERS\" + $hive)) {
                & reg.exe unload ("HKU\" + $hive) *> (Join-Path $evidence ("unload-" + $hive + '.log'))
            }
        }
        # Task Scheduler can release a finished batch profile asynchronously.
        $profileDeadline = (Get-Date).AddSeconds(120)
        do {
            $profile = Get-CimInstance Win32_UserProfile -Filter "SID='$userSid'"
            if (-not $profile) { break }
            try { Remove-CimInstance -InputObject $profile; break } catch { Start-Sleep -Seconds 5 }
        } while ((Get-Date) -lt $profileDeadline)
        $profileRemoved = -not [bool](Get-CimInstance Win32_UserProfile -Filter "SID='$userSid'")
    }
    if ($localUser) { Remove-LocalUser -Name $state.user }
    if (Get-LocalUser -Name $state.user -ErrorAction SilentlyContinue) { throw 'Acceptance user retained' }
    # A disposed hosted VM can retain a loaded profile hive until system logoff.
    # Report this separately from the private credential/account cleanup.
    if (Test-Path $state.root) { Remove-Item $state.root -Recurse -Force }
    if (Test-Path $state.root) { throw 'Acceptance files retained' }
    @{ completedUtc = [DateTime]::UtcNow.ToString('o'); taskRemoved = $true;
       processesRemoved = $true; userRemoved = $true; profileRemoved = $profileRemoved; batchLogonRightRemoved = $rightsRemoved; filesRemoved = $true } |
        ConvertTo-Json | Set-Content (Join-Path $evidence 'cleanup.json')
    if (-not $rightsRemoved) { throw 'Acceptance batch-logon right retained after bounded cleanup' }
    if (-not $profileRemoved) { Write-Warning 'Task Scheduler retained the deleted test account profile hive; the hosted VM disposal is the final profile cleanup boundary.' }
}

if ($CleanupOnly) { Clear-AcceptanceResources; exit 0 }
$id = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$root = "C:\1mcp-acceptance-$id"
$user = "mcpa$id"
$taskName = "1mcp-acceptance-$id"
@{ root = $root; user = $user; task = $taskName } | ConvertTo-Json | Set-Content $statePath
try {
    New-Item -ItemType Directory $root | Out-Null
    $password = 'Aa1!' + [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $secure = ConvertTo-SecureString $password -AsPlainText -Force
    $createdUser = New-LocalUser -Name $user -Password $secure -AccountNeverExpires -PasswordNeverExpires
    @{ root = $root; user = $user; task = $taskName; sid = $createdUser.SID.Value } | ConvertTo-Json | Set-Content $statePath
    [AcceptanceAccountRights]::SetBatchLogon($createdUser.SID.Value, $true)
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
    @{ scenario = $Scenario; mode = $Mode; shell = $Shell; shellPath = $shellPath; cli = $cli;
       task = $taskName; root = $root; account = $account; adminGroup = $adminGroup;
       sourceSha = (& git rev-parse HEAD); nodeVersion = (& $nodePath --version) } |
        ConvertTo-Json | Set-Content (Join-Path $root 'settings.json')
    # CreateProcessWithLogonW returns a filtered token for a new administrator.
    # An explicit Highest scheduler principal supplies the installer token instead.
    $launcher = @'
param([string]$Root)
$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $Root 'temporary-windows-acceptance-worker.ps1') -Root $Root *> (Join-Path $Root 'worker.stdout.log')
    @{ exitCode = 0 } | ConvertTo-Json | Set-Content (Join-Path $Root 'worker.done.json')
} catch {
    $_ | Out-String | Set-Content (Join-Path $Root 'worker.stderr.log')
    @{ exitCode = 1 } | ConvertTo-Json | Set-Content (Join-Path $Root 'worker.done.json')
    exit 1
}
'@
    $launcher | Set-Content (Join-Path $root 'launcher.ps1')
    $launchArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Root "{1}"' -f (Join-Path $root 'launcher.ps1'), $root
    $launchAction = New-ScheduledTaskAction -Execute $shellPath -Argument $launchArgs -WorkingDirectory $root
    $launchSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
    $launchPrincipal = New-ScheduledTaskPrincipal -UserId $account -LogonType Password -RunLevel Highest
    $launchDefinition = New-ScheduledTask -Action $launchAction -Settings $launchSettings -Principal $launchPrincipal
    $bootstrapName = $taskName + '-bootstrap'
    Register-ScheduledTask -TaskName $bootstrapName -InputObject $launchDefinition -User $account -Password $password | Out-Null
    Start-ScheduledTask -TaskName $bootstrapName
    $donePath = Join-Path $root 'worker.done.json'
    $deadline = (Get-Date).AddMinutes(40)
    while (-not (Test-Path $donePath) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 15
        Write-Host "Acceptance worker running: $Mode / $Shell / $([DateTime]::UtcNow.ToString('o'))"
    }
    if (-not (Test-Path $donePath)) { throw 'Acceptance worker exceeded 40-minute bound' }
    $done = Get-Content $donePath -Raw | ConvertFrom-Json
    if ($done.exitCode -ne 0) { throw "Acceptance worker failed with exit $($done.exitCode); see evidence" }

} finally {
    if (Test-Path (Join-Path $root 'evidence')) {
        Copy-Item (Join-Path $root 'evidence\*') $evidence -Recurse -Force
    }
    foreach ($name in @('worker.stdout.log', 'worker.stderr.log')) {
        if (Test-Path (Join-Path $root $name)) { Copy-Item (Join-Path $root $name) $evidence }
    }
    Clear-AcceptanceResources
}
