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

Use this page when you want `1mcp serve` to start automatically on Windows boot and restart after failures, with Task Scheduler as the sole supervisor.

**When to use this page:**

- You are on Windows and need a persistent daemon equivalent to a Linux systemd service
- You want automatic startup on boot with restart-on-failure
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
- **Do not** run the task as SYSTEM or with elevated privileges. Use a dedicated least-privilege Windows account with password logon.
- **Always** pass an explicit `--config-dir` with an absolute path so the daemon, the `1mcp serve --status` check, and any `1mcp proxy` client all share the same Runtime Scope.

## Step 1: Prepare the Configuration Directory

Choose a stable absolute path for the config directory. A system-wide path works well for multi-user machines; a user path works for single-user setups.

```powershell
# System-wide (recommended)
$configDir = 'C:\ProgramData\1mcp'

# Or user-scoped
# $configDir = "$env:LOCALAPPDATA\1mcp"

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

# Create a minimal config if you do not have one yet
@'
{
  "$schema": "https://docs.1mcp.app/schemas/v1.0.0/mcp-config.json",
  "mcpServers": {}
}
'@ | Set-Content -Path "$configDir\mcp.json" -Encoding UTF8

# Grant the task account Modify access so it can write server.pid, state files, and logs.
# Replace '.\1mcp-svc' with the actual account that will run the task.
$taskAccount = Read-Host 'Task account that will run 1mcp (DOMAIN\user or .\user)'
icacls $configDir /grant "${taskAccount}:(OI)(CI)M" | Out-Null
```

## Step 2: Register the Scheduled Task

### Primary path: standalone binary

Download the standalone binary from the [releases page](https://github.com/1mcp-app/agent/releases) and save it to a stable absolute path, for example `C:\Program Files\1mcp\1mcp.exe`.

Run the following from an **elevated PowerShell session**. The script prompts for credentials at registration time and never embeds a password.

```powershell
$binaryPath = 'C:\Program Files\1mcp\1mcp.exe'   # adjust to your installation path
$configDir  = 'C:\ProgramData\1mcp'               # must match Step 1
$taskName   = '1mcp-daemon'

$action = New-ScheduledTaskAction `
    -Execute $binaryPath `
    -Argument "serve --transport http --host 127.0.0.1 --port 3050 --config-dir `"$configDir`"" `
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

$principal = New-ScheduledTaskPrincipal `
    -LogonType Password `
    -RunLevel Limited

# Prompts for account and password interactively — credentials are never embedded in scripts
$cred = Get-Credential -Message 'Enter the Windows account that will run 1mcp'

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -User $cred.UserName `
    -Password $cred.GetNetworkCredential().Password `
    -Description '1MCP aggregated MCP runtime' `
    -Force
```

> **Credential handling:** `Get-Credential` shows a secure dialog; the password is passed directly to `Register-ScheduledTask` and stored by the Task Scheduler service in its encrypted credential store. Never put passwords in scripts or environment variables.

### Secondary path: npm installation

If you installed 1MCP via npm (`npm install -g @1mcp/agent`), use the generated `1mcp.cmd` wrapper through `cmd.exe`. Do not hard-code the path to `node.exe` or the internal `build/index.js`.

```powershell
$configDir = 'C:\ProgramData\1mcp'
$taskName  = '1mcp-daemon'

# Locate the generated cmd wrapper
$cmdWrapper = (Get-Command 1mcp.cmd -ErrorAction Stop).Source

$action = New-ScheduledTaskAction `
    -Execute 'cmd.exe' `
    -Argument "/c `"$cmdWrapper`" serve --transport http --host 127.0.0.1 --port 3050 --config-dir `"$configDir`"" `
    -WorkingDirectory $configDir

# $trigger, $settings, $principal — same as the standalone binary path above
```

## Key Settings Explained

| Setting                            | Value                     | Why                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MultipleInstances`                | `IgnoreNew`               | Prevents a second daemon from starting if the first has not exited yet after a fast reboot                                                                                                                              |
| `ExecutionTimeLimit`               | `PT0S` (zero = unlimited) | A running daemon must not be killed by a default 72-hour execution cap                                                                                                                                                  |
| `RestartCount` / `RestartInterval` | 5 × 2 min                 | Gives time for transient failures to recover without spinning immediately                                                                                                                                               |
| `StartWhenAvailable`               | `true`                    | If the task is eligible to run but conditions temporarily prevent it (e.g. another instance is still stopping), start it as soon as conditions allow. Does **not** recover a missed boot — `AtStartup` fires every boot |
| `RunLevel`                         | `Limited`                 | Runs without elevated privileges; use the minimum permissions needed                                                                                                                                                    |
| `LogonType`                        | `Password`                | Non-interactive logon with supplied credentials; the task runs whether or not the user is logged on                                                                                                                     |
| No boot delay                      | —                         | Add a fixed delay only if your environment requires a VPN or domain authentication to be established before 1MCP can reach upstream servers                                                                             |

## Runtime Scope and `--config-dir`

1MCP writes a `server.pid` file into the `--config-dir` directory at startup. Clients such as `1mcp proxy` read that file to discover the running daemon.

Because Task Scheduler launches the process in a non-interactive session, always pass an explicit absolute `--config-dir`. If the config dir defaults to a user-relative path (e.g. `%APPDATA%\1mcp`) and the task user differs from the interactive user, discovery will fail.

```powershell
# Correct: absolute path, same on daemon and client
1mcp serve  --config-dir 'C:\ProgramData\1mcp' ...
1mcp proxy  --config-dir 'C:\ProgramData\1mcp' ...
1mcp serve --status --config-dir 'C:\ProgramData\1mcp'
```

## Lifecycle Management

```powershell
$taskName = '1mcp-daemon'

# Start the daemon now (without waiting for next boot)
Start-ScheduledTask -TaskName $taskName

# Stop the daemon gracefully
Stop-ScheduledTask -TaskName $taskName

# Stop first, then prevent automatic restart on reboot
Stop-ScheduledTask -TaskName $taskName
Disable-ScheduledTask -TaskName $taskName

# Re-enable automatic restart
Enable-ScheduledTask -TaskName $taskName

# Stop first, then remove the task entirely
Stop-ScheduledTask -TaskName $taskName
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
```

## Post-Registration Verification

Work through this checklist after registering the task and starting it for the first time.

```powershell
$configDir = 'C:\ProgramData\1mcp'
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

## Troubleshooting

| Symptom                               | Likely cause                                       | Fix                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task shows **Ready** but never starts | System not fully ready when the boot trigger fired | Start the task manually once to confirm it works, then add `-Delay (New-TimeSpan -Minutes 1)` to `New-ScheduledTaskTrigger -AtStartup` if the daemon consistently needs extra boot time |
| Task starts but exits immediately     | Wrong binary path or missing `--config-dir`        | Check the task action path and that `$configDir` exists                                                                                                                                 |
| `server.pid` missing after start      | Daemon crashed on startup                          | Check the log file in `$configDir\logs\server.log`                                                                                                                                      |
| Two daemon processes running          | `MultipleInstances` not set to `IgnoreNew`         | Re-register with the settings from Step 2                                                                                                                                               |
| `1mcp proxy` cannot find the daemon   | `--config-dir` mismatch between task and client    | Ensure both use the same absolute path                                                                                                                                                  |
| Credentials rejected at registration  | Wrong user format                                  | Use `DOMAIN\user` for domain accounts or `.\user` for local accounts                                                                                                                    |

## Advanced: S4U Logon (Local-Only)

S4U logon (`LogonType S4U` with no password) avoids storing credentials but has significant restrictions on Windows: it has **no access to network resources or encrypted files**. Use S4U only on machines where the config directory is on a local unencrypted drive and no upstream MCP servers require network authentication.

```powershell
# S4U principal — local only, no network access
$principal = New-ScheduledTaskPrincipal `
    -UserId '.\1mcp-svc' `
    -LogonType S4U `
    -RunLevel Limited
```

For most deployments, password logon (the default in Step 2) is the correct choice.

---

**➡️ See also:** [Cloud Deployment with Caddy](/guide/advanced/cloud-deployment) for public HTTPS deployments
