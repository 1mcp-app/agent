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

当你希望 `1mcp serve` 在 Windows 开机时自动启动，并由任务计划程序作为唯一监管者、按需提供定时恢复时，请使用本页。

**适合阅读本页的情况：**

- 你在 Windows 上，需要等价于 Linux systemd 服务的持久守护进程
- 你需要开机自动启动、任务计划程序针对符合条件的任务操作失败执行原生重试，并可选启用定时恢复
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
- **不要**以 SYSTEM 账户或提升权限运行任务。使用密码支持的非交互式登录（`LogonType Password`），以当前非特权用户运行。
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
'@ | ForEach-Object { [System.IO.File]::WriteAllText("$configDir\mcp.json", $_, (New-Object System.Text.UTF8Encoding($false))) }
}
```

## 第二步：注册计划任务

### 安装脚本（推荐）

在本仓库的检出目录中，通过管理员 PowerShell 会话运行安装脚本。脚本提示输入任务账户密码，并立即启动前台运行时：

```powershell
# 默认：开机启动，以及任务计划程序针对符合条件的任务操作失败执行原生重试
.\scripts\install-windows-task.ps1 -BinaryPath 'C:\Program Files\1mcp\1mcp.exe'

# 可选的定时恢复；60 分钟只是示例，不是默认值
.\scripts\install-windows-task.ps1 -BinaryPath 'C:\Program Files\1mcp\1mcp.exe' -RecoveryIntervalMinutes 60
.\scripts\install-windows-task.ps1 -UseNpm -RecoveryIntervalMinutes 60

# 预览不修改目录、权限、任务状态或注册
.\scripts\install-windows-task.ps1 -UseNpm -RecoveryIntervalMinutes 60 -WhatIf
```

`-RecoveryIntervalMinutes` 接受 1 至 44,640（31 天）之间的整数分钟。不传该参数就不增加周期触发；显式传入零、负数、小数或超范围值，会在修改已有任务之前失败。

启用后保留开机触发器，另加独立的 `Once` 触发器，无限期重复。首次定时启动在注册后的一个间隔发生，安装脚本仍会立即启动任务。错过的间隔不会集中补发启动；任务运行期间，`IgnoreNew` 阻止另一个计划实例启动。

任务设置请求任务计划程序在其将任务操作失败判定为符合原生重试条件时，最多重试五次，间隔两分钟。这一边界属于任务计划程序策略，不保证每个应用程序非零退出都会触发重试。

周期触发与原生重试策略彼此独立。每个周期到达时，已停止且启用的任务都可以重新计划启动，包括发生失败、正常退出或手动停止之后。周期触发不会检测或终止仍在运行但不健康的运行时；已有实例运行时，`IgnoreNew` 会阻止新增计划实例。每次启动仍遵守运行时范围的所有权检查，不会接管其他所有者或删除所有权元数据。

替换任务时，用 `-Force` 重新运行脚本，并指定所需间隔；省略间隔会移除原有周期触发。替换和卸载都会先禁用自动启动，再停止任务，并在 30 秒内验证停止完成。维护失败时，保留的任务注册仍处于禁用状态；请按下方步骤恢复。

下方手动注册示例展示默认配置，**仅用于首次注册**。替换和删除请使用安装脚本，以验证停止完成。

### 主路径：独立二进制文件

从 [releases 页面](https://github.com/1mcp-app/agent/releases)下载独立二进制文件，保存到稳定的绝对路径，例如 `C:\Program Files\1mcp\1mcp.exe`。

在**管理员权限的 PowerShell 会话**中运行以下脚本。脚本通过 `Get-Credential` 在注册时提示输入您的 Windows 密码。密码由任务计划程序安全存储在 Windows 凭据管理器（DPAPI 加密）中——不会嵌入脚本或记录到日志中。

```powershell
$binaryPath = 'C:\Program Files\1mcp\1mcp.exe'   # 调整为你的实际安装路径
$configDir  = "$env:APPDATA\1mcp"                 # 使用绝对路径，不要用提升后管理员的配置目录
$taskName   = '1mcp-daemon'
$taskAccount = 'DOMAIN\user'                       # 运行守护进程的最小权限账户

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

$cred = Get-Credential -UserName $taskAccount -Message "输入 $taskAccount 的密码——该账户将运行 1mcp 守护任务。"
if (-not $cred) {
    throw 'Credential prompt cancelled. Cannot register task without credentials.'
}
$plainPassword = $cred.GetNetworkCredential().Password

# 确保日志目录存在（Session 0 无控制台；--log-file 是可见的必要条件）
New-Item -ItemType Directory -Force -Path "$configDir\logs" | Out-Null

# 授予任务账户修改权限，以便写入 server.pid 和日志
icacls $configDir /grant "${taskAccount}:(OI)(CI)M" | Out-Null

# -User + -Password 隐式设置 LogonType=Password 和 RunLevel=Limited
# 不要添加 -Principal——它属于不同的参数集，会触发 AmbiguousParameterSet 错误
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description '1MCP 聚合 MCP 运行时' `
    -User $taskAccount `
    -Password $plainPassword
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
    -Argument "/s /c `"`"$cmdWrapper`" serve --transport http --host 127.0.0.1 --port 3050 --config-dir `"$configDir`" --log-file `"$configDir\logs\server.log`"`"" `
    -WorkingDirectory $configDir

# $trigger、$settings、$cred、Register-ScheduledTask —— 与独立二进制路径相同
```

## 关键参数说明

| 参数                               | 值                  | 原因                                                                                                             |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `MultipleInstances`                | `IgnoreNew`         | 快速重启后若上一个实例尚未退出，阻止第二个守护进程启动                                                           |
| `ExecutionTimeLimit`               | `PT0S`（零=无限制） | 防止默认 72 小时执行上限将运行中的守护进程强制终止                                                               |
| `RestartCount` / `RestartInterval` | 5 次 × 2 分钟       | 针对任务计划程序判定为符合原生重试条件的失败，请求最多五次重试、间隔两分钟；不保证每个应用程序非零退出都会重试     |
| `StartWhenAvailable`               | `true`              | 仅为错过的基于时间的计划启动保留。**不**适用于 `AtStartup` 启动恢复（该触发器每次开机都会触发）。                |
| `RunLevel`                         | `Limited`           | 以非提升权限运行，使用所需的最小权限                                                                             |
| `LogonType`                        | `Password`          | 通过 Session 0 在开机时运行（无桌面窗口）。密码通过 `Get-Credential` 提示输入，加密存储在 Windows 凭据管理器中。 |
| 无固定启动延迟                     | —                   | 仅当环境需要 VPN 或域认证先于 1MCP 建立时，才考虑添加固定延迟                                                    |

## 运行时范围与 `--config-dir`

1MCP 在启动时会将 `server.pid` 文件写入 `--config-dir` 目录。`1mcp proxy` 等客户端通过读取该文件来发现正在运行的守护进程。

由于计划任务采用 `LogonType Password` 在 Session 0 中运行，守护进程使用注册时指定的 `--config-dir` 路径来解析其运行时范围。后台守护进程与所有前台命令（如 `1mcp proxy`）只要使用相同的 `--config-dir`，即可共享完全一致的运行时范围（Runtime Scope）。

```powershell
# 此时两者均默认使用相同的用户目录，服务自动发现能够完美工作
1mcp serve  # 前台运行：任务计划程序监管该进程
1mcp proxy  # 自动读取当前用户的 %APPDATA%\1mcp\server.pid 并成功连接
```

## 生命周期管理

```powershell
$taskName = '1mcp-daemon'

# 立即启动，无需等待下一个触发器
Start-ScheduledTask -TaskName $taskName

# 临时停止：启用中的周期任务可能在下一个间隔再次启动
Stop-ScheduledTask -TaskName $taskName

# 持久维护：必须先禁用，再停止，防止计划触发
Disable-ScheduledTask -TaskName $taskName
Stop-ScheduledTask -TaskName $taskName

# 确认已停止；仍有实例时不可继续维护
(Get-ScheduledTask -TaskName $taskName).State
# 预期：Disabled；还须确认该任务的运行时进程已退出
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$scheduler.GetFolder('\').GetTask($taskName).GetInstances(0).Count
# 预期：0。仅 Disabled 状态不能证明实例已停止。

# 检查所有权和配置后，由操作员明确恢复
Enable-ScheduledTask -TaskName $taskName
Start-ScheduledTask -TaskName $taskName

# 使用有界、经过停止验证的卸载流程
.\scripts\install-windows-task.ps1 -Uninstall -TaskName $taskName
```

### 维护失败后的恢复

禁用后维护失败时，安装脚本返回失败，并报告任务注册是否保留、停止是否已确认。凭据取消和输入校验发生在禁用之前，此类失败保持已有任务不变。替换或卸载失败后，不会静默重新启用或启动保留的任务。检查错误、任务状态、任务实例及运行时所有权之前，请保持禁用。不要删除 `server.pid` 或强制接管以绕过不确定的所有权。

停止超时时，先确认旧任务进程已退出，再重试替换或卸载。凭据取消、权限或注册失败时，修复报告的问题，携带所需间隔和 `-Force`（或 `-Uninstall`）重新运行安装脚本。如果旧注册仍可用，且明确决定恢复它，应先确认停止完成及目标运行时范围，再执行 `Enable-ScheduledTask` 和 `Start-ScheduledTask`。

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

### 在 Windows 上验证定时恢复

导出注册配置，检查两个触发器和设置：

```powershell
Export-ScheduledTask -TaskName $taskName | Set-Content -Encoding Unicode '.\1mcp-task.xml'
```

启用周期触发时，应包含 `BootTrigger` 和 `TimeTrigger`、指定的重复间隔，不包含重复 `Duration` 或触发器 `EndBoundary`，并保留前台 `serve`、`IgnoreNew`、无限执行时间，以及针对符合条件的任务操作失败请求最多五次、间隔两分钟的原生重试策略。不传该参数时仅有 `BootTrigger`。微软文档说明了[间隔范围](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-interval-repetitiontype-element)及[省略持续时间时无限重复](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-duration-repetitiontype-element)。

在专用测试运行时范围中，分别验证二进制和 npm 安装，并覆盖 Windows PowerShell 5.1 和 PowerShell 7。为以下场景记录导出 XML、任务历史、进程身份和时间戳：

- 一个符合条件的任务操作失败，随后观察到首次启动失败及五次原生启动重试；重试耗尽后先保持空闲，再由周期触发健康启动。在相应字段和事件可用时，按任务计划程序的失败事件、时间戳和实例标识关联这些启动；预启动失败可能不会产生操作开始或操作完成事件。
- 启用期间正常退出或手动停止后，按周期再次启动。
- 运行中的任务跨过周期边界，仅有一个任务实例。
- 其他进程拥有同一运行时范围时，计划启动必须拒绝接管。
- 先禁用再停止，跨过周期边界仍无启动。
- 替换能启用、修改和移除周期触发；卸载确认停止后移除注册。
- 停止超时、停止失败及注册或移除失败时，保留禁用任务并准确报告。
- `-WhatIf` 保持任务状态、XML 和文件系统权限不变。

安装脚本的模拟测试和导出 XML 本身不能证明真实运行时恢复。完成生命周期观测后，才能认为 Windows 部署已经验证。

## 故障排查

| 现象                           | 可能原因                                 | 解决方法                                                                                                                                     |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务显示**就绪**但从未启动     | 开机触发时系统尚未就绪                   | 手动启动一次确认功能正常；若守护进程常出现开机延迟，在 `New-ScheduledTaskTrigger -AtStartup` 中添加 `-RandomDelay (New-TimeSpan -Minutes 1)` |
| 任务启动后立即退出             | 二进制路径错误或缺少 `--config-dir`      | 检查任务操作路径，确认 `$configDir` 目录存在                                                                                                 |
| 启动后 `server.pid` 文件不存在 | 守护进程启动崩溃                         | 检查 `$configDir\logs\server.log` 中的日志                                                                                                   |
| 出现两个守护进程               | `MultipleInstances` 未设置为 `IgnoreNew` | 按第二步重新注册任务                                                                                                                         |
| `1mcp proxy` 无法发现守护进程  | 任务与客户端的 `--config-dir` 不一致     | 确保两者使用相同的绝对路径                                                                                                                   |

## Password 登录与 S4U 登录对比

本指南默认使用密码支持的非交互式登录（`LogonType Password`）进行守护进程注册，它具有以下优势：

- **开机即启动且无窗口**：结合 `AtStartup` 触发器，任务在 Session 0 中运行——无桌面窗口可见，无需用户交互登录。
- **保留网络访问**：与 S4U 登录不同，Password 登录提供完整的网络资源和加密用户文件访问能力，这对于解析和运行上游 MCP 服务是必要的。
- **密码安全存储**：密码通过 `Get-Credential` 提示输入，存储在 Windows 凭据管理器（DPAPI 加密）中，不会嵌入脚本或记录到日志中。

> **注意**：如果您更改了 Windows 密码，需要重新运行注册脚本以更新存储的任务凭据。S4U 登录避免了此问题，但牺牲了网络访问能力，因此不适合作为默认选项。

---

**➡️ 另请参阅：** [使用 Caddy 进行云端部署](/zh/guide/advanced/cloud-deployment)（适用于需要公网 HTTPS 的部署场景）
