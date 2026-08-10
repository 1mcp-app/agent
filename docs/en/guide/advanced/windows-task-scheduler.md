---
title: Run 1MCP with Windows Task Scheduler
description: Run 1MCP as a persistent foreground service on Windows with Task Scheduler, automatic restart, scoped logs, and post-boot health checks.
head:
  - [
      'meta',
      { name: 'keywords', content: '1MCP Windows,Task Scheduler,Windows service,persistent daemon,scheduled task' },
    ]
---

# Run 1MCP with Windows Task Scheduler

Use this guide when one 1MCP runtime must start at boot, survive sign-out, and recover after a process failure on Windows.

## Deployment model

Windows Task Scheduler is the only process supervisor in this setup. Its action runs foreground `1mcp serve` directly.

Do not add `--background` or `--restart` to the task action. Those options start 1MCP's own detached [Background Runtime Supervisor](/commands/serve#start-in-the-background), so Task Scheduler would monitor the launcher instead of the long-lived runtime.

Run the task as the same least-privileged Windows account that owns the selected [Runtime Scope](/commands/serve#runtime-scope-and-lifecycle). The examples bind to `127.0.0.1`; expose the runtime beyond the machine only after applying the [security guidance](/guide/advanced/security).

## Prerequisites

1. Install the [standalone Windows binary](/guide/installation#standalone-binaries) at a stable absolute path, or install `@1mcp/agent` globally with npm.
2. Sign in as the account that will run 1MCP and create its configuration and log directories.
3. Record the task account name and absolute paths. Do not derive them from `$env:APPDATA` in an elevated shell that belongs to another account.
4. Open PowerShell as Administrator only when registering the task.

For example, run this first as the task account:

```powershell
$scope = Join-Path $env:APPDATA '1mcp'
$logDirectory = Join-Path $scope 'logs'
New-Item -ItemType Directory -Force -Path $scope, $logDirectory | Out-Null

Write-Host "Runtime Scope: $scope"
Write-Host "Log directory: $logDirectory"
```

Place `mcp.json` in the displayed Runtime Scope, or use `--config` in the task arguments to select a specific file within it.

## Register the task

The examples enable async loading so the HTTP listener can become available while backends connect. They do not use the retired `--async-min-servers` or `--async-timeout` compatibility options.

### Standalone binary (recommended)

In an elevated PowerShell window, replace the task name, account name, binary path, and Runtime Scope for the task account:

```powershell
$taskName = '1mcp-daemon'
$taskUser = 'CONTOSO\svc-1mcp'
$binary = 'C:\Program Files\1MCP\1mcp-win32-x64.exe'
$scope = 'C:\Users\svc-1mcp\AppData\Roaming\1mcp'
$logFile = Join-Path $scope 'logs\server.log'
$runtimeCommand = $binary

if (-not (Test-Path -LiteralPath $binary)) { throw "1MCP binary not found: $binary" }
if (-not (Test-Path -LiteralPath $scope)) { throw "Runtime Scope not found: $scope" }

$arguments = @(
  'serve'
  '--transport http'
  '--host 127.0.0.1'
  '--port 3050'
  "--config-dir `"$scope`""
  '--enable-async-loading'
  '--enable-config-reload'
  '--log-level info'
  "--log-file `"$logFile`""
) -join ' '

$action = New-ScheduledTaskAction `
  -Execute $binary `
  -Argument $arguments `
  -WorkingDirectory (Split-Path $binary)
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan) `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 2) `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

$credential = Get-Credential -UserName $taskUser -Message 'Enter the task account password'
$password = $credential.GetNetworkCredential().Password
Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description '1MCP Aggregated Runtime' `
  -User $credential.UserName `
  -Password $password `
  -RunLevel Limited `
  -Force
Remove-Variable password, credential
```

The zero `ExecutionTimeLimit` allows the runtime to run indefinitely. Task Scheduler makes five restart attempts at two-minute intervals after a failure. `IgnoreNew` prevents overlapping task instances, and `StartWhenAvailable` starts a task whose boot trigger was missed. Battery use is allowed so a laptop power-state change does not stop the runtime.

### npm installation

For a global npm installation, replace the standalone action above with this `cmd.exe` action before calling `Register-ScheduledTask`. Use the task account's absolute npm shim path; do not call the package-internal `build/index.js`, which can move during upgrades.

```powershell
$npmShim = 'C:\Users\svc-1mcp\AppData\Roaming\npm\1mcp.cmd'
$cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
$cmdArguments = '/d /s /c ""{0}" {1}"' -f $npmShim, $arguments
$runtimeCommand = $npmShim

if (-not (Test-Path -LiteralPath $npmShim)) { throw "1MCP npm shim not found: $npmShim" }
$action = New-ScheduledTaskAction `
  -Execute $cmdExe `
  -Argument $cmdArguments `
  -WorkingDirectory (Split-Path $npmShim)
```

## Manage the task

Use Task Scheduler for lifecycle operations so it remains the sole supervisor:

```powershell
# Start now instead of waiting for the next boot
Start-ScheduledTask -TaskName $taskName

# Stop without treating the stop as a process failure
Stop-ScheduledTask -TaskName $taskName

# Restart
Stop-ScheduledTask -TaskName $taskName
while ((Get-ScheduledTask -TaskName $taskName).State -ne 'Ready') {
  Start-Sleep -Seconds 1
}
Start-ScheduledTask -TaskName $taskName
```

To keep the runtime stopped across reboots, disable the task before stopping it:

```powershell
Disable-ScheduledTask -TaskName $taskName
Stop-ScheduledTask -TaskName $taskName
```

Enable and start it only when service should resume:

```powershell
Enable-ScheduledTask -TaskName $taskName
Start-ScheduledTask -TaskName $taskName
```

## Verify the runtime

The explicit `--config-dir` keeps configuration, `<config-dir>\server.pid` lifecycle metadata, and local status discovery in the same Runtime Scope. Use that exact path for every status command:

```powershell
Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State
Get-ScheduledTaskInfo -TaskName $taskName | Format-List LastRunTime, LastTaskResult, NextRunTime

& $runtimeCommand serve --status --config-dir $scope
Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3050 -State Listen
Invoke-WebRequest http://127.0.0.1:3050/health/ready -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:3050/health/mcp -UseBasicParsing | Select-Object StatusCode, Content
Get-Content $logFile -Tail 50
```

`/health/ready` returns `200` when the runtime is ready and `503` when it is not. `/health/mcp` returns `202` while backend loading continues and `200` when loading has completed; inspect its JSON summary because completion can include failed backends.

## Optional startup delay

Do not gate the task on a Windows network profile, and do not add a fixed delay by default. Backends can reconnect as network dependencies become available.

If a domain policy or VPN consistently needs extra boot time, open the task in Task Scheduler, edit the startup trigger, and set **Delay task for** to the shortest proven interval, such as 30 seconds. Treat the delay as an environment-specific workaround, not a readiness check.

## Security and logon notes

- Register from elevated PowerShell, but use `RunLevel Limited` for the runtime.
- Use password-backed non-interactive logon so the task can start before sign-in and access network resources. The password is prompted for during registration and is not embedded in the script.
- Update the stored task credential when the account password changes.
- Do not use `SYSTEM`, `Highest`, or an interactive-token task by default.
- S4U is an advanced local-only alternative. It has no network or encrypted-file access, so it is unsuitable when 1MCP or its backends require either.

See Microsoft's documentation for [task logon types](https://learn.microsoft.com/windows/win32/api/taskschd/ne-taskschd-task_logon_type), [scheduled task settings](https://learn.microsoft.com/powershell/module/scheduledtasks/new-scheduledtasksettingsset), and [unlimited execution time](https://learn.microsoft.com/windows/win32/taskschd/tasksettings-executiontimelimit).

## Windows validation checklist

Validate both installation paths and every lifecycle check below on the actual Windows host before putting the deployment into service:

- [ ] The standalone binary action starts successfully.
- [ ] The npm `1mcp.cmd` action starts successfully.
- [ ] A real reboot starts the task before interactive sign-in.
- [ ] Terminating the runtime process causes one scheduled replacement.
- [ ] A deliberate `Stop-ScheduledTask` does not respawn the runtime.
- [ ] Starting the task again while it is running leaves only one runtime PID.
- [ ] `serve --status` observes the intended Runtime Scope.
- [ ] `/health/ready` and `/health/mcp` report the expected state.
- [ ] The configured log contains expected lifecycle output and no credentials.

## See also

- **[Serve command](/commands/serve)**
- **[Fast startup](/guide/advanced/fast-startup)**
- **[Health checks](/reference/health-check)**
- **[Security](/guide/advanced/security)**
