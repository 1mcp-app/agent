---
title: 后端准备
description: 配置副本专属的只读就绪探测，以及运行时拥有的异步准备命令。
---

# 后端准备

运行时为选定的 Project Checkout 管理准备任务。集成提供只读就绪探测和前台准备命令；后端名称、版本、索引文件、Git HEAD、连接状态和命令日志本身都不证明就绪。

## 运行时配置

在现有服务器定义中添加以下元数据，并将示例路径替换为已安装的集成脚本：

```json
{
  "preparation": {
    "adapter": "configured-command",
    "affectedTools": ["lookup"],
    "allowedActions": ["initialize", "sync"],
    "integration": {
      "probe": { "executable": "/absolute/path/to/readiness-wrapper", "args": ["{checkout}", "{operation}"] },
      "readinessExitCodes": {
        "0": { "state": "ready" },
        "2": { "state": "required", "action": "initialize", "instructions": "初始化选定副本。" },
        "3": { "state": "required", "action": "sync", "instructions": "同步源码变更。" },
        "4": { "state": "conflict", "instructions": "先核对现有写入者的所有权。" }
      },
      "actions": {
        "initialize": {
          "executable": "/absolute/path/to/prepare-wrapper",
          "args": ["initialize", "{checkout}", "{operation}"]
        },
        "sync": { "executable": "/absolute/path/to/prepare-wrapper", "args": ["sync", "{checkout}", "{operation}"] }
      },
      "containment": "posix-process-group"
    }
  }
}
```

命令使用 executable 和参数数组，不进行隐式 shell 解析。参数中的 `{checkout}`、`{operation}` 会被替换，工作目录是选定的规范副本路径。命令仅由运行时配置授权，项目偏好和请求参数不能新增命令。

探测必须确认实际副本及操作的源码新鲜度和覆盖范围，包括未提交变更。未映射退出码和超时报告 unknown；日志只是有界诊断。无法证明新鲜度时应报告 unknown。`affectedTools` 可以是明确的上游工具名称数组或 `"all"`；其他工具保持原有行为。被保护的后端缺少 integration 时报告 unsupported。

每个动作可配置 `successExitCodes`（默认 `[0]`）和 `transientExitCodes`，两者不能重叠。只有明确分类的瞬时失败可以在 `transientRetryLimit` 和任务截止时间内自动重试。重建、安装依赖和付费服务分别要求运行时显式授予 `rebuild`、`install`、`paid`，项目不能扩大权限。

可选 `status` 使用相同的命令结构，退出零时输出 JSON，支持可选字段 `message`、`completed`、`total`、`unit`。显式检查验证这些进度字段；缺少进度时报告不可用，不从日志推算百分比。probe/status 必须只读且有界。`inspectionTimeoutMs` 默认 5000，`outputLimitBytes` 默认 16384。

准备命令及后代必须保持在运行时拥有的进程组内。当前实现支持 Linux 和 macOS；其他平台在动作启动前拒绝准备。containment 声明由操作人员确认集成脚本满足约束，脱离进程组或后台分离的写入者不属于此契约。原生写入者协调由集成负责；运行时不终止外部进程，也不破坏外部锁。

## 可复用本地定义（高级）

运行时操作者可通过定义标识和**绝对本地 JSON 文件路径**选择可复用定义。加载不依赖调用方工作目录；项目偏好和工具参数不能选择可执行定义或增加权限。

```json
{
  "preparation": {
    "adapter": "configured-command",
    "definition": {
      "id": "local-source-search",
      "file": "/opt/1mcp/integrations/source-search.json",
      "inputs": { "database": "/opt/source-search/database" }
    },
    "allowedActions": ["initialize", "sync"]
  }
}
```

定义包含 `schemaVersion: 1`、唯一 `id`、`revision`、`helperRevision`、`compatibility`（后端、版本、平台、就绪范围）、输入声明、`affectedTools` 以及前述配置命令格式的 `integration`。参数中的 `{input:database}` 按字面替换已声明的操作者输入。兼容性声明本身不证明后端身份或就绪；仍需原生探测。

定义标识必须与选择一致。未知 schema 版本、重复内置标识、本地文件冒充内置定义、缺失或未知输入，以及命名定义与内联配置冲突都会报错。不能同时配置 `definition` 和内联 `integration`。命名定义拥有受影响工具列表，显式配置的列表必须完全一致。

运行时 `allowedActions` 与定义默认值分离；更新定义不会授权新动作。有效定义内容和命令修订参与准备任务身份计算，不能复用不兼容的旧任务或就绪证据；运行中的任务保留已解析的配置快照。就绪检查与工具最终分发屏障都会拒绝已改变的有效定义。

维护自定义辅助脚本时，操作者必须在行为改变后更新 `helperRevision`。可选 `helperFiles` 最多列出八个本地文件，总大小不超过 1 MiB，文件内容哈希参与身份计算。相对声明基于定义文件目录解析。作为完整可执行路径或 argv 参数引用的已声明脚本会绑定到规范绝对路径，包括 `helper.cjs` 与 `./helper.cjs` 写法；之后改变符号链接不会重定向已保留的命令。复合参数或解释器源码字符串中的嵌入引用不受支持，会被拒绝；运行时不解析任意解释器代码。

每个保留的适配器拥有自己的预期脚本哈希，在启动命令前和接受探测、进度或动作完成结果前验证。已声明脚本改变或缺失时，探测报告 unknown，动作产生稳定且不可自动重试的 `helper_revision_changed` 失败；不能以旧身份触发 ready 能力刷新。应重新解析更新后的定义并显式重试。这些检查不会冻结外部文件，也不提供原子化的可执行内容快照；已准入任务运行期间仍应保持外部可执行文件与脚本不变。

运行时可显式为命名定义设置 `activation: "setup"`，让新授权副本无需逐项目设置准备偏好。后端 `enabled: false` 和项目显式禁用优先。升级不会自动添加 activation，现有内联配置仍要求项目选择启用。

当前内置定义注册表为空。计划中的 CodeGraph、Code Review Graph 和 Serena 集成因原生验收仍被阻塞，尚不可用；这个 Draft 不增加仅提供配置的目录条目。本地定义能力不代表这三个后端的引导配置或自动准备已经完成。已测覆盖和阻塞项见 [CodeGraph 与 Code Review Graph 验收记录](/zh/guide/preparation-native-acceptance)及 [Serena 验收记录](/zh/guide/preparation-serena-acceptance)。

## 项目选择启用

有效 `.1mcprc` 按配置服务器名称启用自动准备：

```json
{ "preparation": { "source-search": { "enabled": true } } }
```

对于内联命令，以及未显式设置运行时 setup activation 的命名定义，没有该偏好时自动准备关闭。显式准备仍遵守运行时动作权限和副本授权。关联工作树按完整文件规则继承偏好，本地配置替换继承文件。参见[项目副本与集合](/zh/guide/project-checkouts)。

## 控制与异步调用

初始工具发现为空时也能使用准备控制：

```bash
1mcp preparation inspect source-search --project /work/frontend --operation lookup --format json
1mcp prepare source-search --project /work/frontend --operation lookup --format json
OPERATION_ID='replace-with-returned-job-id'
1mcp preparation status source-search "$OPERATION_ID" --project /work/frontend
1mcp preparation wait source-search "$OPERATION_ID" --project /work/frontend --wait-ms 5000
1mcp preparation cancel source-search "$OPERATION_ID" --project /work/frontend
1mcp preparation retry source-search "$OPERATION_ID" --project /work/frontend
```

`inspect` 只读取就绪证据、任务状态、动作、已用时间和明确可用的进度，不调度准备、不修复状态、不重试失败。句柄绑定认证主体、目标、操作和有效配置。带 ID 的控制自动恢复其操作，显式冲突的操作会被拒绝。

未就绪的受保护工具调用及时返回任务 ID 和状态。**原始操作没有执行，也没有排队等待回放**，即使准备很快完成也一样；确认就绪后需重新提交工具请求。兼容请求共享任务，不同副本、操作或策略不共享。调用方断开不会取消共享任务。

每个任务只执行一个动作。动作退出成功后重新探测，只有确认 ready 才刷新允许的能力，包括初始为空的工具清单。仍需另一动作时任务以 `not_ready` 结束。显式重试会重新探测，仅在运行时策略允许时将新要求的动作作为独立任务调度，并保留原任务的终态记录；不会自动串联动作。终态失败保留到显式重试。其他未受保护或已就绪工具保持可用。

## 限额与恢复

默认同时运行一个昂贵任务，最多排队 16 个，执行期限 120000 毫秒且不含排队时间，请求检查/等待预算 5000 毫秒。应用 `[preparation]` 设置调度限额，后端元数据可设 `executionDeadlineMs`、`transientRetryLimit`。延长期限需要明确修改运行时配置。

取消和执行超时停止拥有的动作进程及附属后代，直接子进程退出不能证明后代已停止。重启仅将保存状态视为参考：配置的只读探测核对当前就绪状态和原生写入者协调。原生 conflict 在外部核对并解决前保持阻止；解决后 inspect 可只读报告当前状态，显式重试可调度仍需执行的准备。保存的 PID 或标志不授权终止进程、重复写入、删除索引或破坏外部锁；检查不会抹去这些事实。

## 真实集成验收

CodeGraph 与 Code Review Graph 通过外部包装脚本使用相同配置命令契约。仓库 `examples/backend-preparation/README.md` 提供有界原生验收包装器，`scripts/verify-configured-preparation.mjs` 用于重复运行验收。Code Review Graph 的 status 本身不证明未提交源码新鲜度，包装脚本需要单独核验或明确报告缺口。运行时核心不解析后端专属就绪字段。验收证据需记录后端版本、平台、副本源码规模、冷准备时间、热探测开销、共享任务数、其他已就绪工具延迟、取消覆盖和可取得的 CPU/内存观察。通过本地测试不代表部署或客户端已激活。
