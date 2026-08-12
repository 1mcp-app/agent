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
'@ | Set-Content -Path "$configDir\mcp.json" -Encoding UTF8
}
```

## Step 2: Register the Scheduled Task

### Primary path: standalone binary

Download the standalone binary from the [releases page](https://github.com/1mcp-app/agent/releases) and save it to a stable absolute path, for example `C:\Program Files\1mcp\1mcp.exe`.

Run the following from an **elevated PowerShell session**. The script prompts for your Windows password via `Get-Credential` at registration time. The password is stored securely by Task Scheduler in the Windows Credential Manager (DPAPI encrypted) — it is never embedded in the script or logged.

```powershell
$binaryPath = 'C:\Program Files\1mcp\1mcp.exe'   # adjust to your installation path
$configDir  = "$env:APPDATA\1mcp"
$taskName   = '1mcp-daemon'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

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
    -UserId $currentUser `
    -LogonType Password `
    -RunLevel Limited

$cred = Get-Credential -UserName $currentUser -Message "Enter your Windows password for the 1mcp daemon task."
if (-not $cred) {
    Write-Error 'Credential prompt cancelled. Cannot register task without credentials.'
}
$plainPassword = $cred.GetNetworkCredential().Password

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description '1MCP aggregated MCP runtime' `
    -User $currentUser `
    -Password $plainPassword `
    -Force
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
    -Argument "/s /c `"`"$cmdWrapper`" serve --transport http --host 127.0.0.1 --port 3050 --config-dir `"$configDir`"`"" `
    -WorkingDirectory $configDir

# $trigger, $settings, $principal — same as the standalone binary path above
```

## Key Settings Explained

| Setting                            | Value                     | Why                                                                                                                                                   |
| ---------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MultipleInstances`                | `IgnoreNew`               | Prevents a second daemon from starting if the first has not exited yet after a fast reboot                                                            |
| `ExecutionTimeLimit`               | `PT0S` (zero = unlimited) | A running daemon must not be killed by a default 72-hour execution cap                                                                                |
| `RestartCount` / `RestartInterval` | 5 × 2 min                 | Gives time for transient failures to recover without spinning immediately                                                                             |
| `StartWhenAvailable`               | `true`                    | If the task is eligible to run but conditions temporarily prevent it (e.g. another instance is still stopping), start it as soon as conditions allow. |
| `RunLevel`                         | `Limited`                 | Runs without elevated privileges; use the minimum permissions needed                                                                                  |
| `LogonType`                        | `Password`                | Runs at boot via Session 0 (no desktop window). Password prompted via `Get-Credential`, stored encrypted in Windows Credential Manager.               |
| No boot delay                      | —                         | Add a fixed delay only if your environment requires a VPN or domain authentication to be established before 1MCP can reach upstream servers           |

## Runtime Scope and `--config-dir`

1MCP writes a `server.pid` file into the `--config-dir` directory at startup. Clients such as `1mcp proxy` read that file to discover the running daemon.

Because the scheduled task runs in Session 0 under `LogonType Password`, the daemon uses the `--config-dir` path specified during registration to resolve its Runtime Scope. Both the background daemon and any foreground commands (like `1mcp proxy`) share the same Runtime Scope as long as they use the same `--config-dir`.

```powershell
# Both commands share the user configuration scope by default
1mcp serve  # Run in background or foreground
1mcp proxy  # Automatically discovers and connects to the running daemon
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
