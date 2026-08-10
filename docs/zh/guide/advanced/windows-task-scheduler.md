---
title: 通过 Windows 任务计划程序运行 1MCP
description: 使用 Windows 任务计划程序以前台服务方式持久运行 1MCP，并配置故障重启、作用域日志和开机后健康检查。
head:
  - ['meta', { name: 'keywords', content: '1MCP Windows,任务计划程序,Windows 服务,持久化守护进程,计划任务' }]
---

# 通过 Windows 任务计划程序运行 1MCP

当一个 1MCP 运行时需要开机启动、在用户注销后继续运行，并在进程失败后自动恢复时，请使用本指南。

## 部署模型

在此方案中，Windows 任务计划程序是唯一的进程 supervisor，其 action 直接运行前台 `1mcp serve`。

不要在任务 action 中添加 `--background` 或 `--restart`。这些选项会启动 1MCP 自己的分离式 [Background Runtime Supervisor](/zh/commands/serve#后台启动)，导致任务计划程序只能监控启动器，而不是长期运行的运行时。

任务应使用拥有所选 [Runtime Scope（运行时作用域）](/zh/commands/serve#运行时作用域与生命周期)的同一个最小权限 Windows 账户运行。示例只绑定 `127.0.0.1`；只有在应用[安全指南](/zh/guide/advanced/security)后，才应让本机以外的客户端访问运行时。

## 前置条件

1. 将[独立 Windows 二进制文件](/zh/guide/installation#独立二进制文件)安装到稳定的绝对路径，或者使用 npm 全局安装 `@1mcp/agent`。
2. 以将要运行 1MCP 的账户登录，并创建其配置与日志目录。
3. 记录任务账户名和绝对路径。不要从属于其他账户的提权 PowerShell 中通过 `$env:APPDATA` 推导这些路径。
4. 仅在注册任务时以管理员身份打开 PowerShell。

例如，先以任务账户运行：

```powershell
$scope = Join-Path $env:APPDATA '1mcp'
$logDirectory = Join-Path $scope 'logs'
New-Item -ItemType Directory -Force -Path $scope, $logDirectory | Out-Null

Write-Host "Runtime Scope: $scope"
Write-Host "Log directory: $logDirectory"
```

将 `mcp.json` 放入显示的 Runtime Scope；也可以在任务参数中使用 `--config`，选择该作用域内的特定文件。

## 注册任务

示例启用异步加载，使 HTTP 监听器可以在后端连接期间先变为可用。示例不会使用已经退役的 `--async-min-servers` 或 `--async-timeout` 兼容选项。

### 独立二进制文件（推荐）

在提权 PowerShell 窗口中，替换任务名称、账户名称、二进制路径和任务账户的 Runtime Scope：

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

值为零的 `ExecutionTimeLimit` 允许运行时无限期运行。进程失败后，任务计划程序会以两分钟为间隔尝试重启五次。`IgnoreNew` 防止任务实例重叠，`StartWhenAvailable` 会补跑错过的开机触发。允许使用电池，避免笔记本电脑电源状态变化时停止运行时。

### npm 安装

如果使用全局 npm 安装，请在调用 `Register-ScheduledTask` 前，用下面的 `cmd.exe` action 替换上面的独立二进制 action。请使用任务账户的 npm shim 绝对路径；不要调用可能在升级时移动的包内部 `build/index.js`。

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

## 管理任务

使用任务计划程序完成生命周期操作，确保它始终是唯一的 supervisor：

```powershell
# 立即启动，不必等待下次开机
Start-ScheduledTask -TaskName $taskName

# 停止且不把主动停止视为进程失败
Stop-ScheduledTask -TaskName $taskName

# 重启
Stop-ScheduledTask -TaskName $taskName
while ((Get-ScheduledTask -TaskName $taskName).State -ne 'Ready') {
  Start-Sleep -Seconds 1
}
Start-ScheduledTask -TaskName $taskName
```

如需让运行时在重启后仍保持停止，请先禁用任务，再停止任务：

```powershell
Disable-ScheduledTask -TaskName $taskName
Stop-ScheduledTask -TaskName $taskName
```

只有在需要恢复服务时才重新启用并启动：

```powershell
Enable-ScheduledTask -TaskName $taskName
Start-ScheduledTask -TaskName $taskName
```

## 验证运行时

明确指定 `--config-dir` 后，配置、`<config-dir>\server.pid` 生命周期元数据与本地状态发现都会位于同一个 Runtime Scope。每个状态命令都应使用完全相同的路径：

```powershell
Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State
Get-ScheduledTaskInfo -TaskName $taskName | Format-List LastRunTime, LastTaskResult, NextRunTime

& $runtimeCommand serve --status --config-dir $scope
Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3050 -State Listen
Invoke-WebRequest http://127.0.0.1:3050/health/ready -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:3050/health/mcp -UseBasicParsing | Select-Object StatusCode, Content
Get-Content $logFile -Tail 50
```

运行时就绪时，`/health/ready` 返回 `200`；未就绪时返回 `503`。后端仍在加载时，`/health/mcp` 返回 `202`；加载完成后返回 `200`。完成状态仍可能包含失败的后端，因此还应检查其 JSON 摘要。

## 可选的启动延迟

不要让任务依赖某个 Windows 网络配置文件，也不要默认添加固定延迟。后端可以在网络依赖可用后重新连接。

如果域策略或 VPN 确实总是需要额外的开机时间，请在任务计划程序中打开此任务、编辑启动触发器，并把“延迟任务时间”设置为经过验证的最短间隔，例如 30 秒。该延迟只是特定环境的规避措施，不能替代就绪检查。

## 安全与登录说明

- 从提权 PowerShell 注册任务，但运行时使用 `RunLevel Limited`。
- 使用密码支持的非交互登录，使任务可以在用户登录前启动并访问网络资源。密码只在注册时提示输入，不会嵌入脚本。
- 账户密码变更后，需要更新任务中保存的凭据。
- 默认不要使用 `SYSTEM`、`Highest` 或交互式 token 任务。
- S4U 是高级的纯本地替代方案。它无法访问网络或加密文件，因此当 1MCP 或其后端需要其中任一能力时都不适用。

参阅 Microsoft 关于[任务登录类型](https://learn.microsoft.com/windows/win32/api/taskschd/ne-taskschd-task_logon_type)、[计划任务设置](https://learn.microsoft.com/powershell/module/scheduledtasks/new-scheduledtasksettingsset)和[无限执行时间](https://learn.microsoft.com/windows/win32/taskschd/tasksettings-executiontimelimit)的文档。

## Windows 验证清单

在实际 Windows 主机上将部署投入使用前，请验证两种安装路径以及下面的每一项生命周期行为：

- [ ] 独立二进制 action 可以成功启动。
- [ ] npm `1mcp.cmd` action 可以成功启动。
- [ ] 真实重启后，任务可在交互式登录前启动。
- [ ] 终止运行时进程后，任务只启动一个替代进程。
- [ ] 主动执行 `Stop-ScheduledTask` 后不会重新派生运行时。
- [ ] 运行期间再次启动任务时仍只有一个运行时 PID。
- [ ] `serve --status` 能观察到预期的 Runtime Scope。
- [ ] `/health/ready` 与 `/health/mcp` 报告预期状态。
- [ ] 配置的日志包含预期生命周期输出，且不含凭据。

## 另请参阅

- **[Serve 命令](/zh/commands/serve)**
- **[快速启动](/zh/guide/advanced/fast-startup)**
- **[健康检查](/zh/reference/health-check)**
- **[安全](/zh/guide/advanced/security)**
