---
title: Windows 任务计划程序
description: 在 Windows 上将 1MCP 作为持久后台进程，由任务计划程序托管。涵盖独立二进制和 npm 两种路径、最小权限登录、运行时范围一致性及启动后验证。
head:
  - ['meta', { name: 'keywords', content: '1MCP Windows,任务计划程序,后台服务,持久部署,计划任务,PowerShell' }]
  - ['meta', { property: 'og:title', content: '1MCP Windows 任务计划程序部署' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: '使用 Windows 任务计划程序将 1MCP 部署为持久后台守护进程，支持独立二进制和 npm 两种安装路径。',
      },
    ]
---

# Windows：任务计划程序

本页适用于以下场景：你在 Windows 上，需要 `1mcp serve` 在开机时自动启动并在崩溃后自动恢复，任务计划程序作为唯一的进程监管者。

**适合阅读本页的情况：**

- 你在 Windows 上，需要等价于 Linux systemd 服务的持久守护进程
- 你需要开机自动启动并支持崩溃重启
- 你使用独立二进制文件或通过 npm 安装的 `1mcp`

## 前置条件

- Windows 10 / Windows Server 2016 或更新版本
- PowerShell 5.1 或 PowerShell 7+
- 1MCP 独立二进制文件 **或** 通过 npm 安装的 `1mcp`
- 一个管理员权限的 PowerShell 会话 —— 仅用于首次执行 `Register-ScheduledTask`

> **任务注册只需要一次管理员权限。** 注册完成后，任务将以配置的非特权用户身份运行，与当前登录用户无关。

## 部署约定

任务计划程序是监管者，`1mcp serve` 在该任务内以前台进程方式运行。

- **不要**传递 `--background` 或 `--restart` 参数。这些参数会附加额外的监管进程；任务计划程序监控的将是短暂的启动器，而非真正的守护进程。
- **不要**以 SYSTEM 账户或提升权限运行任务。使用专用的最小权限 Windows 账户，配置密码登录。
- **始终**通过 `--config-dir` 传递绝对路径，确保守护进程、`1mcp serve --status` 命令以及所有 `1mcp proxy` 客户端共享同一个运行时范围。

## 第一步：准备配置目录

选择一个稳定的绝对路径作为配置目录。多用户场景推荐使用系统级路径；单用户场景可以使用用户级路径。

```powershell
# 系统级路径（推荐）
$configDir = 'C:\ProgramData\1mcp'

# 或用户级路径
# $configDir = "$env:LOCALAPPDATA\1mcp"

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

# 如果还没有配置文件，创建一个最小配置
@'
{
  "$schema": "https://docs.1mcp.app/schemas/v1.0.0/mcp-config.json",
  "mcpServers": {}
}
'@ | Set-Content -Path "$configDir\mcp.json" -Encoding UTF8
```

## 第二步：注册计划任务

### 主路径：独立二进制文件

从 [releases 页面](https://github.com/1mcp-app/agent/releases)下载独立二进制文件，保存到稳定的绝对路径，例如 `C:\Program Files\1mcp\1mcp.exe`。

在**管理员权限的 PowerShell 会话**中运行以下脚本。脚本会在注册时交互式提示输入凭据，绝不在脚本中嵌入密码。

```powershell
$binaryPath = 'C:\Program Files\1mcp\1mcp.exe'   # 调整为你的实际安装路径
$configDir  = 'C:\ProgramData\1mcp'               # 必须与第一步一致
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
    -UserId (Read-Host '输入运行 1mcp 的 Windows 账户（格式：DOMAIN\user 或 .\user）') `
    -LogonType Password `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description '1MCP 聚合 MCP 运行时' `
    -Force

# 此处会提示输入账户密码
$task = Get-ScheduledTask -TaskName $taskName
Set-ScheduledTask -InputObject $task -Password (Read-Host '密码' -AsSecureString | `
    [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)))
```

> **凭据处理：** 密码在注册时通过交互方式提供，由任务计划程序服务以加密方式存储。请勿将密码写入脚本或环境变量。

### 次路径：npm 安装

如果你通过 npm 安装了 1MCP（`npm install -g @1mcp/agent`），请通过 `cmd.exe` 使用生成的 `1mcp.cmd` 包装器。不要硬编码 `node.exe` 路径或内部 `build/index.js` 路径。

```powershell
$configDir = 'C:\ProgramData\1mcp'
$taskName  = '1mcp-daemon'

# 定位生成的 cmd 包装器
$cmdWrapper = (Get-Command 1mcp.cmd -ErrorAction Stop).Source

$action = New-ScheduledTaskAction `
    -Execute 'cmd.exe' `
    -Argument "/c `"$cmdWrapper`" serve --transport http --host 127.0.0.1 --port 3050 --config-dir `"$configDir`"" `
    -WorkingDirectory $configDir

# $trigger、$settings、$principal —— 与独立二进制路径相同
```

## 关键参数说明

| 参数                               | 值                  | 原因                                                                                                     |
| ---------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| `MultipleInstances`                | `IgnoreNew`         | 快速重启后若上一个实例尚未退出，阻止第二个守护进程启动                                                   |
| `ExecutionTimeLimit`               | `PT0S`（零=无限制） | 防止默认 72 小时执行上限将运行中的守护进程强制终止                                                       |
| `RestartCount` / `RestartInterval` | 5 次 × 2 分钟       | 给瞬时故障留出恢复时间，避免立即循环重启                                                                 |
| `StartWhenAvailable`               | `true`              | 若任务在启动时被错过（如机器关机），尽快启动                                                             |
| `RunLevel`                         | `Limited`           | 以非提升权限运行，使用所需的最小权限                                                                     |
| `LogonType`                        | `Password`          | 使用提供的凭据进行非交互式登录；无论用户是否登录，任务均可运行                                           |
| 无固定启动延迟                     | —                   | `StartWhenAvailable` 已能优雅处理延迟启动。仅当环境需要 VPN 或域认证先于 1MCP 建立时，才考虑添加固定延迟 |

## 运行时范围与 `--config-dir`

1MCP 在启动时会将 `server.pid` 文件写入 `--config-dir` 目录。`1mcp proxy` 等客户端通过读取该文件来发现正在运行的守护进程。

由于任务计划程序在非交互式会话中启动进程，请始终传递显式的绝对 `--config-dir`。如果配置目录默认为用户相对路径（如 `%APPDATA%\1mcp`）且任务用户与交互用户不同，服务发现将会失败。

```powershell
# 正确：绝对路径，守护进程和客户端保持一致
1mcp serve  --config-dir 'C:\ProgramData\1mcp' ...
1mcp proxy  --config-dir 'C:\ProgramData\1mcp' ...
1mcp serve --status --config-dir 'C:\ProgramData\1mcp'
```

## 生命周期管理

```powershell
$taskName = '1mcp-daemon'

# 立即启动守护进程（无需等待下次开机触发）
Start-ScheduledTask -TaskName $taskName

# 停止守护进程（任务计划程序将在下次开机触发时重新启动）
Stop-ScheduledTask -TaskName $taskName

# 停止并阻止重启后自动启动
Disable-ScheduledTask -TaskName $taskName

# 重新启用自动启动
Enable-ScheduledTask -TaskName $taskName

# 完全删除任务
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
```

## 注册后验证清单

首次注册任务并启动后，逐一执行以下检查。

```powershell
$configDir = 'C:\ProgramData\1mcp'
$taskName  = '1mcp-daemon'

# 1. 手动启动任务进行首次测试
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 5

# 2. 任务计划程序状态
schtasks /query /tn "\$taskName" /fo LIST /v | Select-String '状态'
# 预期：状态: 正在运行

# 3. 1MCP 运行时状态
1mcp serve --status --config-dir $configDir
# 预期：running (ready)

# 4. server.pid 文件存在
Test-Path "$configDir\server.pid"
# 预期：True

# 5. 端口处于监听状态
Get-NetTCPConnection -LocalPort 3050 -State Listen -ErrorAction SilentlyContinue
# 预期：一条 LocalAddress 为 127.0.0.1 的记录

# 6. 就绪端点
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3050/health/ready' | Select-Object StatusCode
# 预期：200

# 7. MCP 加载状态
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3050/health/mcp' | Select-Object StatusCode
# 预期：200（全部加载完成）或 202（仍在加载中）
```

## 故障排查

| 现象                           | 可能原因                                 | 解决方法                                        |
| ------------------------------ | ---------------------------------------- | ----------------------------------------------- |
| 任务显示**就绪**但从未启动     | 触发器在网络就绪前触发                   | 启用 `StartWhenAvailable`，或手动启动一次任务   |
| 任务启动后立即退出             | 二进制路径错误或缺少 `--config-dir`      | 检查任务操作路径，确认 `$configDir` 目录存在    |
| 启动后 `server.pid` 文件不存在 | 守护进程启动崩溃                         | 检查 `$configDir\logs\server.log` 中的日志      |
| 出现两个守护进程               | `MultipleInstances` 未设置为 `IgnoreNew` | 按第二步重新注册任务                            |
| `1mcp proxy` 无法发现守护进程  | 任务与客户端的 `--config-dir` 不一致     | 确保两者使用相同的绝对路径                      |
| 注册时凭据被拒绝               | 用户名格式错误                           | 域账户使用 `DOMAIN\user`，本地账户使用 `.\user` |

## 高级选项：S4U 登录（仅限本地）

S4U 登录（`LogonType ServiceAccount`，无需密码）可以避免存储凭据，但在 Windows 上有明显限制：**无法访问网络资源或加密文件**。仅当配置目录位于本地未加密驱动器且所有上游 MCP 服务器不需要网络认证时，才考虑使用 S4U。

```powershell
# S4U 主体 —— 仅限本地，无网络访问
$principal = New-ScheduledTaskPrincipal `
    -UserId '.\1mcp-svc' `
    -LogonType S4U `
    -RunLevel Limited
```

对于大多数部署场景，第二步中的密码登录方式是正确的选择。

---

**➡️ 另请参阅：** [使用 Caddy 进行云端部署](/zh/guide/advanced/cloud-deployment)（适用于需要公网 HTTPS 的部署场景）
