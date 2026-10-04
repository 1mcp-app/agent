---
title: Windows Task Scheduler
description: Run 1MCP as a persistent Windows daemon supervised by Task Scheduler. Covers standalone binary and npm paths, least-privilege logon, Runtime Scope consistency, and post-boot verification.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: '1MCP Windows,Task Scheduler,daemon,persistent,Windows deployment,scheduled task,PowerShell',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Windows Task Scheduler Deployment' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Deploy 1MCP as a persistent Windows daemon using Task Scheduler. Step-by-step guide with standalone binary and npm paths.',
      },
    ]
---

# Windows: Task Scheduler

Use this page when you want `1mcp serve` to start automatically on Windows boot, with Task Scheduler as the sole supervisor and optional scheduled recovery.

**When to use this page:**

- You are on Windows and need a persistent daemon equivalent to a Linux systemd service
- You want automatic startup on boot, Task Scheduler's native restart policy for eligible task-action failures, and optional scheduled recovery
- You are using the standalone binary or an npm-installed `1mcp`

## Prerequisites

- Windows 10 / Windows Server 2016 or newer
- PowerShell 5.1 or PowerShell 7+
- The standalone 1MCP binary **or** `1mcp` installed via npm
- An elevated PowerShell session — only for the initial `Register-ScheduledTask` call

> **Task registration requires Administrator once.** After registration the task runs as the configured non-privileged user regardless of who is logged on.

## Deployment Contract

Task Scheduler is the supervisor. `1mcp serve` runs in the foreground inside that task.

- **Do not** pass `--background` or `--restart`. Those flags attach an extra supervisor; Task Scheduler would then monitor the short-lived launcher instead of the real daemon.
- **Do not** run the task as SYSTEM or with elevated privileges. Use password-backed non-interactive logon (`LogonType Password`) to run as the current non-privileged user.
- **Recommend** using the user-scoped configuration path so the daemon, the `1mcp serve --status` check, and any `1mcp proxy` client all share the same Runtime Scope.

## Step 1: Prepare the Configuration Directory

Choose a user-scoped absolute path for the config directory to match the default environment of the logged-in user.

```powershell
$configDir = "$env:APPDATA\1mcp"

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

# Create a minimal config if you do not have one yet (prevent overwriting existing config)
if (-not (Test-Path "$configDir\mcp.json")) {
    @'
{
  "$schema": "https://docs.1mcp.app/schemas/v1.0.0/mcp-config.json",
  "mcpServers": {}
}
'@ | ForEach-Object { [System.IO.File]::WriteAllText("$configDir\mcp.json", $_, (New-Object System.Text.UTF8Encoding($false))) }
}
```

## Step 2: Register the Scheduled Task

### Installer (recommended)

From a checkout of this repository, run the installer in an elevated PowerShell session. It prompts for the task account password and starts the foreground runtime immediately:

```powershell
# Default: startup plus Task Scheduler's native policy for eligible task-action failures
.\scripts\install-windows-task.ps1 -BinaryPath 'C:\Program Files\1mcp\1mcp.exe'

# Optional scheduled recovery; 60 minutes is an example, not a default
.\scripts\install-windows-task.ps1 -BinaryPath 'C:\Program Files\1mcp\1mcp.exe' -RecoveryIntervalMinutes 60
.\scripts\install-windows-task.ps1 -UseNpm -RecoveryIntervalMinutes 60

# Preview without changing directories, permissions, task state or registration
.\scripts\install-windows-task.ps1 -UseNpm -RecoveryIntervalMinutes 60 -WhatIf
```

`-RecoveryIntervalMinutes` accepts whole minutes from 1 through 44,640 (31 days). Omission adds no recurrence; explicitly supplied zero, negative, fractional or out-of-range values fail before changing an existing task.

Opt-in retains the startup trigger and adds a separate `Once` trigger with indefinite repetition. Its first scheduled launch is one interval after registration; the installer still starts the task immediately. Missed intervals do not produce a burst of catch-up launches. `IgnoreNew` prevents another scheduled instance while the task is running.

The task settings request up to five native restarts at two-minute intervals when Task Scheduler treats a task-action failure as eligible for its restart policy. This is a scheduler policy boundary, not a guarantee that every nonzero application exit will be retried.

Recurrence is independent of the native restart policy. At each interval, a stopped, enabled task is eligible for a new scheduled launch, including after a failure, clean exit or manual stop. Recurrence does not detect or terminate an unhealthy running runtime. `IgnoreNew` prevents an additional scheduled instance while one is running. Every launch still uses normal Runtime Scope ownership checks; recurrence cannot take over another owner or remove ownership metadata.

To replace a task, rerun the installer with `-Force` and the desired interval. Omit the interval to remove prior recurrence. Replacement and uninstall disable automatic launches before stopping and verify shutdown within 30 seconds. If maintenance fails, retained registration stays disabled; follow the failure recovery steps below.

The manual registration examples below show the default task configuration for **initial registration only**. Use the installer for replacement and removal so shutdown is verified.

### Primary path: standalone binary

Download the standalone binary from the [releases page](https://github.com/1mcp-app/agent/releases) and save it to a stable absolute path, for example `C:\Program Files\1mcp\1mcp.exe`.

Run the following from an **elevated PowerShell session**. The script prompts for your Windows password via `Get-Credential` at registration time. The password is stored securely by Task Scheduler in the Windows Credential Manager (DPAPI encrypted) — it is never embedded in the script or logged.

```powershell
$binaryPath = 'C:\Program Files\1mcp\1mcp.exe'   # adjust to your installation path
$configDir  = "$env:APPDATA\1mcp"                 # use an absolute path, NOT the elevated admin's profile
$taskName   = '1mcp-daemon'
$taskAccount = 'DOMAIN\user'                       # the least-privileged account that will run the daemon

$action = New-ScheduledTaskAction `
    -Execute $binaryPath `
    -Argument "serve --transport http --host 127.0.0.1 --port 3050 --config-dir `"$configDir`" --log-file `"$configDir\logs\server.log`"" `
    -WorkingDirectory $configDir

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$cred = Get-Credential -UserName $taskAccount -Message "Enter the password for $taskAccount — this account will run the 1mcp daemon task."
if (-not $cred) {
    throw 'Credential prompt cancelled. Cannot register task without credentials.'
}
$plainPassword = $cred.GetNetworkCredential().Password

# Ensure log directory exists (Session 0 has no console; --log-file is required for visibility)
New-Item -ItemType Directory -Force -Path "$configDir\logs" | Out-Null

# Grant the task account Modify access so it can write server.pid and logs
icacls $configDir /grant "${taskAccount}:(OI)(CI)M" | Out-Null

# -User + -Password implicitly sets LogonType=Password and RunLevel=Limited.
# Do NOT add -Principal — it belongs to a different parameter set and causes
# an AmbiguousParameterSet error.
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description '1MCP aggregated MCP runtime' `
    -User $taskAccount `
    -Password $plainPassword
```

### Secondary path: npm installation

If you installed 1MCP via npm (`npm install -g @1mcp/agent`), use the generated `1mcp.cmd` wrapper. Do not hard-code the path to `node.exe` or the internal `build/index.js`.

```powershell
$configDir = "$env:APPDATA\1mcp"
$taskName  = '1mcp-daemon'

# Locate the generated cmd wrapper
$cmdWrapper = (Get-Command 1mcp.cmd -ErrorAction Stop).Source

$action = New-ScheduledTaskAction `
    -Execute 'cmd.exe' `
    -Argument "/s /c `"`"$cmdWrapper`" serve --transport http --host 127.0.0.1 --port 3050 --config-dir `"$configDir`" --log-file `"$configDir\logs\server.log`"`"" `
    -WorkingDirectory $configDir

# $trigger, $settings, $cred, Register-ScheduledTask — same as the standalone binary path above
```

## Key Settings Explained

| Setting                            | Value                     | Why                                                                                                                                         |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `MultipleInstances`                | `IgnoreNew`               | Prevents a second daemon from starting if the first has not exited yet after a fast reboot                                                  |
| `ExecutionTimeLimit`               | `PT0S` (zero = unlimited) | A running daemon must not be killed by a default 72-hour execution cap                                                                      |
| `RestartCount` / `RestartInterval` | 5 × 2 min                 | Requests up to five native restarts, two minutes apart, for failures that Task Scheduler treats as restart-eligible; it does not guarantee retries for every nonzero application exit |
| `StartWhenAvailable`               | `true`                    | Retained for missed time-based launches. Does **not** recover an `AtStartup` launch (the trigger fires every boot regardless).              |
| `RunLevel`                         | `Limited`                 | Runs without elevated privileges; use the minimum permissions needed                                                                        |
| `LogonType`                        | `Password`                | Runs at boot via Session 0 (no desktop window). Password prompted via `Get-Credential`, stored encrypted in Windows Credential Manager.     |
| No boot delay                      | —                         | Add a fixed delay only if your environment requires a VPN or domain authentication to be established before 1MCP can reach upstream servers |

## Runtime Scope and `--config-dir`

1MCP writes a `server.pid` file into the `--config-dir` directory at startup. Clients such as `1mcp proxy` read that file to discover the running daemon.

Because the scheduled task runs in Session 0 under `LogonType Password`, the daemon uses the `--config-dir` path specified during registration to resolve its Runtime Scope. Both the background daemon and any foreground commands (like `1mcp proxy`) share the same Runtime Scope as long as they use the same `--config-dir`.

```powershell
# Both commands share the user configuration scope by default
1mcp serve  # Foreground: Task Scheduler supervises the process
1mcp proxy  # Automatically discovers and connects to the running daemon
```

## Lifecycle Management

```powershell
$taskName = '1mcp-daemon'

# Start now without waiting for the next trigger
Start-ScheduledTask -TaskName $taskName

# Temporary stop: an enabled recurring task can start at the next interval
Stop-ScheduledTask -TaskName $taskName

# Durable maintenance: disable BEFORE stopping to prevent scheduled launches
Disable-ScheduledTask -TaskName $taskName
Stop-ScheduledTask -TaskName $taskName

# Confirm shutdown; do not proceed with maintenance while instances remain
(Get-ScheduledTask -TaskName $taskName).State
# Expected: Disabled; also verify that the task's runtime process has exited
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$scheduler.GetFolder('\').GetTask($taskName).GetInstances(0).Count
# Expected: 0. Disabled alone does not prove shutdown.

# Explicitly resume after maintenance, once ownership and configuration are checked
Enable-ScheduledTask -TaskName $taskName
Start-ScheduledTask -TaskName $taskName

# Remove using bounded, verified shutdown
.\scripts\install-windows-task.ps1 -Uninstall -TaskName $taskName
```

### Recovering from failed maintenance

If maintenance fails after disabling, the installer returns failure and reports whether registration remains and whether shutdown was confirmed. Credential cancellation and input validation happen before disabling, so those failures leave the existing task unchanged. It never silently re-enables or restarts a retained task after failed replacement or uninstall. Keep it disabled until you have inspected the error, task state, task instances and runtime ownership. Do not remove `server.pid` or force takeover to bypass uncertain ownership.

For a stop timeout, confirm that the old task's process has exited before retrying replacement or uninstall. For cancelled credentials, permission or registration failures, correct the reported problem and rerun the installer with the desired interval and `-Force` (or `-Uninstall`). If the old registration remains usable and you explicitly choose to resume it, use `Enable-ScheduledTask` followed by `Start-ScheduledTask` only after confirming shutdown and the intended Runtime Scope.

## Post-Registration Verification

Work through this checklist after registering the task and starting it for the first time.

```powershell
$configDir = "$env:APPDATA\1mcp"
$taskName  = '1mcp-daemon'

# 1. Start the task manually for the first test
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 5

# 2. Task Scheduler state
(Get-ScheduledTask -TaskName $taskName).State
# Expected: Running

# 3. 1MCP runtime status
1mcp serve --status --config-dir $configDir
# Expected: running (ready)

# 4. server.pid exists
Test-Path "$configDir\server.pid"
# Expected: True

# 5. Port is listening
Get-NetTCPConnection -LocalPort 3050 -State Listen -ErrorAction SilentlyContinue
# Expected: one entry with LocalAddress 127.0.0.1

# 6. Readiness endpoint
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3050/health/ready' | Select-Object StatusCode
# Expected: 200

# 7. MCP loading status
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3050/health/mcp' | Select-Object StatusCode
# Expected: 200 (all servers loaded) or 202 (still loading)
```

### Verify scheduled recovery on Windows

Export the registered configuration and inspect both triggers and settings:

```powershell
Export-ScheduledTask -TaskName $taskName | Set-Content -Encoding Unicode '.\1mcp-task.xml'
```

With recurrence enabled, expect a `BootTrigger` plus a `TimeTrigger`, the selected repetition interval, no repetition `Duration` or trigger `EndBoundary`, foreground `serve`, `IgnoreNew`, unlimited execution and a native policy requesting up to five restart attempts at two-minute intervals for eligible task-action failures. Without the parameter, expect only `BootTrigger`. Microsoft documents the [interval bounds](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-interval-repetitiontype-element) and [indefinite repetition when duration is omitted](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-duration-repetitiontype-element).

In a dedicated test Runtime Scope, validate binary and npm installations separately on Windows PowerShell 5.1 and PowerShell 7. Record exported XML, task history, process identity and timestamps for these cases:

- An eligible task-action failure followed by the initial failed launch and five observed native launch retries, an idle period after exhaustion, then a healthy recurring launch. Correlate Task Scheduler failure events, timestamps and instance identifiers where those fields and events are available; a prelaunch failure might not emit action-start or action-completion events.
- Clean exit and manual stop while enabled, followed by recurrence.
- A running task across a recurrence boundary with only one task instance.
- Another process owning the same Runtime Scope: the scheduled launch must refuse ownership.
- Disable-then-stop across a recurrence boundary with no launch.
- Replacement enabling, changing and removing recurrence; uninstall removing registration after verified shutdown.
- Stop timeout, stop failure and registration/removal failure retaining a disabled task, with accurate output.
- `-WhatIf` preserving task state, XML and filesystem permissions.

Mocked installer tests and exported XML alone do not prove live runtime recovery. Complete the observed lifecycle checks before treating a Windows deployment as verified.

## Troubleshooting

| Symptom                               | Likely cause                                    | Fix                                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task shows **Ready** but never starts | System not fully ready when the trigger fired   | Start the task manually once to confirm it works, then add `-RandomDelay (New-TimeSpan -Minutes 1)` to `New-ScheduledTaskTrigger -AtStartup` if the daemon consistently needs extra delay |
| Task starts but exits immediately     | Wrong binary path or missing `--config-dir`     | Check the task action path and that `$configDir` exists                                                                                                                                   |
| `server.pid` missing after start      | Daemon crashed on startup                       | Check the log file in `$configDir\logs\server.log`                                                                                                                                        |
| Two daemon processes running          | `MultipleInstances` not set to `IgnoreNew`      | Re-register with the settings from Step 2                                                                                                                                                 |
| `1mcp proxy` cannot find the daemon   | `--config-dir` mismatch between task and client | Ensure both use the same absolute path                                                                                                                                                    |

## Password Logon vs S4U Logon

This guide defaults to password-backed non-interactive logon (`LogonType Password`) for daemon registration. It offers several benefits:

- **Boot-time start with no window:** Combined with the `AtStartup` trigger, the task runs in Session 0 — no desktop window is visible, no user needs to be logged in interactively.
- **Network access preserved:** Unlike S4U logon, password logon provides full access to network resources and encrypted user files, which is necessary for resolving and running upstream MCP servers.
- **Password stored securely:** The password is prompted via `Get-Credential` and stored in the Windows Credential Manager (DPAPI encrypted). It is never embedded in the script or logged.

> **Note:** If you change your Windows password, you must re-run the registration script to update the stored task credentials. S4U logon avoids this but sacrifices network access, making it unsuitable as a default.

---

**➡️ See also:** [Cloud Deployment with Caddy](/guide/advanced/cloud-deployment) for public HTTPS deployments
