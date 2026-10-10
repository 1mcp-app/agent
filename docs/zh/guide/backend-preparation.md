---
title: 工作副本专属的后端准备
description: 启用有边界的 CodeGraph 索引准备，查看就绪状态，并控制运行时拥有的索引任务。
---

# 工作副本专属的后端准备

后端准备使选定工作副本的源码索引在相关工具执行前可用。跨仓库或 Git worktree 工作时，请明确选择目标。其他副本的索引、已连接的服务或成功的工具发现，都不能证明当前目标的源码覆盖。

## 运行时权限与项目选择

运行时配置规定后端允许的操作；项目的 `.1mcprc` 按**已配置的服务名称**选择是否自动准备。项目配置不能扩大运行时权限。

在现有服务定义中加入：

```json
{
  "preparation": {
    "adapter": "codegraph",
    "executable": "/absolute/path/to/already-installed/codegraph",
    "expectedVersion": "1.6.2",
    "sourceMonitor": "git-fsmonitor",
    "allowedActions": ["initialize", "sync"]
  }
}
```

适配器只使用已安装且验证过的后端，不下载或安装 CodeGraph。`sourceMonitor` 明确允许准备过程为选定副本启动前台 Git 原生源码监视器；现有监视器仅借用，检查不会启动源码监视器。当前验证范围是本地 macOS 工作副本、CodeGraph 1.6.2 与 Git 2.52。其他平台、版本、重定位的套接字及不支持的源码配置会报告具体限制；macOS 验证不代表 Windows 或 Linux 已验证。

在有效 `.1mcprc` 中按服务名启用：

```json
{ "preparation": { "codegraph": { "enabled": true } } }
```

未启用时，不自动准备。显式 `prepare` 仍遵守运行时操作权限与目标权限。关联 worktree 可继承主副本的偏好；本地文件会整体替换继承配置，创建时请保留其他需要的设置。参见[工作副本与项目集合](/zh/guide/project-checkouts)。

初始化和增量同步不隐含授权全量重建、安装依赖或付费操作。本适配器验证的操作是 `initialize` 与 `sync`；格式不兼容或中断的索引可能需要另行验证的恢复流程。

## 使用只读 CodeGraph 传输

运行时管理准备时，将第一方 `codegraph-readonly` 启动器配置为普通 stdio 命令。它使用固定版本的原生只读引擎，不启动另一个索引写入者：

```json
{
  "mcpTemplates": {
    "codegraph": {
      "command": "/absolute/path/to/1mcp",
      "args": [
        "codegraph-readonly",
        "--executable=/absolute/path/to/already-installed/codegraph",
        "--path={{project.path}}"
      ],
      "template": { "shareable": true },
      "protocolVersion": "legacy",
      "projectTarget": { "mode": "single" },
      "preparation": {
        "adapter": "codegraph",
        "executable": "/absolute/path/to/already-installed/codegraph",
        "expectedVersion": "1.6.2",
        "sourceMonitor": "git-fsmonitor",
        "allowedActions": ["initialize", "sync"]
      }
    }
  }
}
```

将该命令用于绑定工作副本的模板，并保留现有模板设置和过滤器，另加准备元数据。普通 stdio 生命周期仍由运行时管理；不会自动替换其他已配置命令。启动器只接受配置指定的工作副本，工具参数不能将其切换到其他源码目录。其他原生 CLI 或运行时启动的写入进程仍构成冲突，不会被准备流程终止或夺取所有权。

## 查看状态与控制任务

这些命令直接访问选定的聚合运行时，即使后端最初没有公开工具也可使用：

```bash
1mcp preparation status codegraph --project /work/frontend --format json
1mcp prepare codegraph --project /work/frontend --format json
OPERATION_ID='operation-id-from-prepare-response'
1mcp preparation wait codegraph "$OPERATION_ID" --project /work/frontend --wait-ms 5000
1mcp preparation cancel codegraph "$OPERATION_ID" --project /work/frontend
1mcp preparation retry codegraph "$OPERATION_ID" --project /work/frontend
```

将示例 `OPERATION_ID` 值替换为 `prepare` 返回的 ID。使用操作 ID 时，保持相同的工作副本、运行时选择与认证。ID 绑定已授权目标和调用者，其他调用者的 ID 不授予查看或取消权限。不带 ID 的 `status` 检查当前就绪状态；不带 ID 的 `retry` 可在运行时重启后协调保留的失败。准备要求已验证的本地工作副本上下文，保留现有认证、授权与过滤边界，不签发新的远程信任。

保存的项目集合可使用 `--project-set /work/projects.json --project frontend`。逐个准备成员；选择多个成员不会将单项目后端操作自动分发到每个成员。

检查不修改源码、配置、Git 索引或 CodeGraph 索引。它可以执行有界的原生只读探测，但不会启动索引或源码监视器。Git 原生日志查询可能创建并删除内部协调 cookie，用于确认源码变更已被观察到。普通文件监视器或等待一段时间，本身不能证明源码新鲜度。

## 待准备不是工具结果

相关工具请求可启动或加入一个兼容任务，默认最多等待五秒。未完成时，响应提供待准备状态、操作 ID 与恢复说明。**原后端操作未执行，也未排队等待重放。** 查看状态或等待就绪后，再次提交原工具请求。

该等待预算包含派发前的就绪探测与连接建立。原操作开始执行后使用正常的工具超时。后台准备与最终就绪验证共用执行预算，前台等待到期不会取消它们。

准备成功会刷新能力目录，新公开的工具仍受所选工作副本的过滤器与现有授权限制。其他已就绪工具不需要等待另一个副本的准备。

就绪判断针对预期操作。源码修改、新增或删除文件、分支变化、格式不兼容、部分覆盖以及变更日志丢失，都可能使就绪状态失效。暖检查只在原生日志证明没有相关变更时复用已验证基线，不把数据库存在或 Git HEAD 当作源码最新的证据。

## 预算、失败与恢复

默认一个昂贵任务运行、最多 16 个排队任务、请求等待五秒、执行限时两分钟。排队时间与执行预算分开。兼容请求在入队前去重；不同目标或不兼容配置保持不同任务身份，队列溢出返回忙碌。

在所选 MCP 配置旁的 `config.toml` 中调整运行时限制：

```toml
[preparation]
concurrency = 1
queueCapacity = 16
requestWaitMs = 5000
executionDeadlineMs = 120000
maxRecords = 1024
```

后端的运行时准备元数据还可声明 `executionDeadlineMs`。增加预算需要明确修改运行时配置；重复请求不会暗中放宽限制。

一个等待者断开或等待超时，不会取消共享任务。显式取消和执行超时只停止拥有的准备工作。失败会保留，直到显式重试或原生证据确认问题已解决。执行预算耗尽后，再次长时间尝试需要更大的显式预算；只有后端支持时才保留和继续部分进度。 重试会重新检查原生就绪状态。如果索引现在需要另一种恢复操作，重试保留失败状态并返回明确的恢复说明，不会自动切换操作或授权重建。

重启后的保存状态仅供参考。运行时重新检查原生就绪状态与所有权，不根据保存的运行标记或 PID 发信号，不破坏其他进程的锁，不删除索引，不借用其他副本的索引，也不自动重启失败任务。强制退出的任务可能留下所有权不确定的原生锁，这些锁会保留，需显式人工核对处理。不支持、覆盖不完整或冲突时，请按返回的前置条件和恢复说明处理。

## 已验证的原生测量

2026-10-11（Asia/Shanghai，对应 UTC 2026-10-10）在 Darwin arm64、Git 2.52、CodeGraph 1.6.2 上，通过已初始化的 HTTP/SSE 以及 2026-07-28 请求流程完成验证。冷启动样本包含 20,000 个源文件，每个文件五个函数，源码约 10 MB。

| 观察项                                | 测量结果                                   |
| ------------------------------------- | ------------------------------------------ |
| 冷启动索引 / 后续就绪验证             | 13.97 秒 / 5.47 秒，共用 120 秒后台预算    |
| 前台待准备响应 / 索引期间无关就绪工具 | 5.14 秒 / 98 毫秒                          |
| 热路径原生就绪检查                    | 30 次检查，中位数 27 毫秒，范围 17–58 毫秒 |
| 十轮 HTTP 状态查询与工具调用          | 6.32 秒；未新增准备任务或完整检查          |
| 另外 18 个目标的默认调度              | 一个活动任务、16 个排队任务、两个忙碌响应  |

同一个已初始化客户端收到目录变化通知，并查询到选定源码。关联及独立工作副本、即时编辑、分支切换、等待者断开、取消和外部锁协调均通过验证。显式配置的 1 秒执行期限停止了拥有的索引进程。随后显式增加至 120 秒，`initialize`/`sync` 权限仍拒绝需要重建的恢复，保留数据库且未启动新写入进程。

这些是观测值，不是资源或延迟保证。150 次限定进程采样的单进程最大观测值分别为 645.6% CPU 和 2,511,040 KiB RSS，来自不同进程或时刻；未测量宿主机外部竞争。实际验证的是配置的 1 秒超时，没有等待默认 120 秒超时。部分覆盖及格式不兼容的元数据样本用于验证诊断并已恢复，不代表自然文件损坏的覆盖保证。验证仅针对上述原生版本与平台，也不证明已安装客户端钩子的激活状态。
