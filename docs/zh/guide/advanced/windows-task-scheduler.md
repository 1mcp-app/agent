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
- **不要**以 SYSTEM 账户或提升权限运行任务。使用交互式登录，以当前非特权用户运行。
- **推荐**使用用户级配置路径，确保守护进程、`1mcp serve --status` 命令以及所有 `1mcp proxy` 客户端共享同一个运行时范围。

## 第一步：准备配置目录

选择用户级绝对路径作为配置目录，使其与当前登录用户的默认运行环境保持一致。

```powershell
$configDir = "$env:APPDATA\1mcp"

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

# 如果还没有配置文件，创建一个最小配置（防止覆盖已有配置）
if (-not (Test-Path "$configDir\mcp.json")) {
    @'
{
  "$schema": "https://docs.1mcp.app/schemas/v1.0.0/mcp-config.json",
  "mcpServers": {}
}
'@ | Set-Content -Path "$configDir\mcp.json" -Encoding UTF8
}
```

## 第二步：注册计划任务

### 主路径：独立二进制文件

从 [releases 页面](https://github.com/1mcp-app/agent/releases)下载独立二进制文件，保存到稳定的绝对路径，例如 `C:\Program Files\1mcp\1mcp.exe`。

在**管理员权限的 PowerShell 会话**中运行以下脚本。脚本无需输入或存储您的账户密码。

```powershell
$binaryPath = 'C:\Program Files\1mcp\1mcp.exe'   # 调整为你的实际安装路径
$configDir  = "$env:APPDATA\1mcp"
$taskName   = '1mcp-daemon'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
    -Execute $binaryPath `
    -Argument "serve --transport http --host 127.0.0.1 --port 3050 --config-dir `"$configDir`"" `
    -WorkingDirectory $configDir

$trigger = New-ScheduledTaskTrigger -AtLogon -User $currentUser

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
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description '1MCP 聚合 MCP 运行时' `
    -Force
```

### 次路径：npm 安装

如果你通过 npm 安装了 1MCP（`npm install -g @1mcp/agent`），请使用生成的 `1mcp.cmd` 包装器。不要硬编码 `node.exe` 路径或内部 `build/index.js` 路径。

```powershell
$configDir = "$env:APPDATA\1mcp"
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

| 参数                               | 值                  | 原因                                                                                          |
| ---------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `MultipleInstances`                | `IgnoreNew`         | 快速重启后若上一个实例尚未退出，阻止第二个守护进程启动                                        |
| `ExecutionTimeLimit`               | `PT0S`（零=无限制） | 防止默认 72 小时执行上限将运行中的守护进程强制终止                                            |
| `RestartCount` / `RestartInterval` | 5 次 × 2 分钟       | 给瞬时故障留出恢复时间，避免立即循环重启                                                      |
| `StartWhenAvailable`               | `true`              | 若任务符合运行条件但暂时无法启动（如上一实例仍在停止），则尽快启动。                          |
| `RunLevel`                         | `Limited`           | 以非提升权限运行，使用所需的最小权限                                                          |
| `LogonType`                        | `Interactive`       | 使用交互式登录；任务在配置的用户登录时运行，无需在计划任务中存储或提示输入 Windows 账户密码。 |
| 无固定启动延迟                     | —                   | 仅当环境需要 VPN 或域认证先于 1MCP 建立时，才考虑添加固定延迟                                 |

## 运行时范围与 `--config-dir`

1MCP 在启动时会将 `server.pid` 文件写入 `--config-dir` 目录。`1mcp proxy` 等客户端通过读取该文件来发现正在运行的守护进程。

由于计划任务采用 `LogonType Interactive` 在交互式会话中以您的身份运行，守护进程天然能够读取到当前用户的 `%APPDATA%\1mcp` 目录。这确保了后台守护进程与所有前台命令（如 `1mcp proxy`）默认共享完全一致的运行时范围（Runtime Scope）。

```powershell
# 此时两者均默认使用相同的用户目录，服务自动发现能够完美工作
1mcp serve  # 后台或前台运行
1mcp proxy  # 自动读取当前用户的 %APPDATA%\1mcp\server.pid 并成功连接
```

## 生命周期管理

```powershell
$taskName = '1mcp-daemon'

# 立即启动守护进程（无需等待下次开机触发）
Start-ScheduledTask -TaskName $taskName

# 停止守护进程
Stop-ScheduledTask -TaskName $taskName

# 先停止，再阻止重启后自动启动
Stop-ScheduledTask -TaskName $taskName
Disable-ScheduledTask -TaskName $taskName

# 重新启用自动启动
Enable-ScheduledTask -TaskName $taskName

# 先停止，再完全删除任务
Stop-ScheduledTask -TaskName $taskName
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
```

## 注册后验证清单

首次注册任务并启动后，逐一执行以下检查。

```powershell
$configDir = "$env:APPDATA\1mcp"
$taskName  = '1mcp-daemon'

# 1. 手动启动任务进行首次测试
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 5

# 2. 任务计划程序状态
(Get-ScheduledTask -TaskName $taskName).State
# 预期：Running

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

| 现象                           | 可能原因                                 | 解决方法                                                                                                                                   |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 任务显示**就绪**但从未启动     | 开机触发时系统尚未就绪                   | 手动启动一次确认功能正常；若守护进程常出现开机延迟，在 `New-ScheduledTaskTrigger -AtLogon` 中添加 `-RandomDelay (New-TimeSpan -Minutes 1)` |
| 任务启动后立即退出             | 二进制路径错误或缺少 `--config-dir`      | 检查任务操作路径，确认 `$configDir` 目录存在                                                                                               |
| 启动后 `server.pid` 文件不存在 | 守护进程启动崩溃                         | 检查 `$configDir\logs\server.log` 中的日志                                                                                                 |
| 出现两个守护进程               | `MultipleInstances` 未设置为 `IgnoreNew` | 按第二步重新注册任务                                                                                                                       |
| `1mcp proxy` 无法发现守护进程  | 任务与客户端的 `--config-dir` 不一致     | 确保两者使用相同的绝对路径                                                                                                                 |

## 交互式登录与 S4U 登录对比

本指南默认推荐使用交互式登录（`LogonType Interactive`），它具有以下优势：

- **免密码存储**：与 S4U 一样，不需要在计划任务中存储或输入您的 Windows 账户密码。
- **无网络与文件访问限制**：不像 S4U 那样有无法访问网络资源或加密文件的严格限制，任务能正常加载任何需要联网认证的上游 MCP 服务。

---

**➡️ 另请参阅：** [使用 Caddy 进行云端部署](/zh/guide/advanced/cloud-deployment)（适用于需要公网 HTTPS 的部署场景）
