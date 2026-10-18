---
title: 后端准备
description: 配置副本专属的只读就绪探测，以及运行时拥有的异步准备命令。
---

# 后端准备

运行时为选定的 Project Checkout 管理准备任务。集成提供只读就绪探测和前台准备命令；后端名称、版本、索引文件、Git HEAD、连接状态和命令日志本身都不证明就绪。

## 维护的示例：无需手写配置

先安装后端可执行文件，然后在 `1mcp mcp setup` 中选择示例，或运行：

```bash
1mcp mcp setup --known codegraph
1mcp mcp setup --known code-review-graph
1mcp mcp setup --known serena
```

前置依赖已在 PATH 中时，选择示例并确认默认项即可，无需编写 JSON、脚本、退出码映射或工具清单。命令不在 PATH 中时使用 `--executable /absolute/path/to/backend`。缺少依赖时提供明确指引，配置过程不下载依赖，也不初始化原生索引。

默认创建可复用的副本绑定模板，使用现有项目上下文流程选定并授权的副本，而非配置命令的当前目录。新授权的工作树无需重复配置 1MCP，但仍可能需要原生初始化或 onboarding。固定目标示例：

```bash
1mcp mcp setup --known serena --checkout /absolute/project --name project-serena --dry-run
```

去掉 `--dry-run` 后保存。等价配置保持不变；保留已有覆盖项、密钥引用、禁用项及准备限制。有实质变化的重新配置需要 `--force`。静态/模板名称冲突会被拒绝，不静默迁移。输出区分配置变更、重载观察和原生就绪。配置不扩大副本访问权限。

| 示例              | 原生前置条件及后续步骤                                                                                    | 自动准备     |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ------------ |
| CodeGraph         | 已安装公共 CLI；索引查询前，对选定副本完成原生初始化和同步。                                              | 配置时不启用 |
| Code Review Graph | 已安装公共 CLI；图查询前，对选定仓库完成原生构建和更新。                                                  | 配置时不启用 |
| Serena            | 已安装公共 CLI 及语言工具链/语言服务器；按需完成原生项目设置和 onboarding。可选预热不阻止本已可用的操作。 | 配置时不启用 |

配置成功不证明源码新鲜度。这些示例不启用自动准备；查询副本前应完成原生前置步骤。

完成所需原生步骤后，使用 `1mcp serve` 启动已配置的运行时。在另一终端中检查或调用模板时选择副本：

```bash
1mcp inspect codegraph --project /absolute/project
1mcp inspect code-review-graph --project /absolute/project
1mcp inspect serena --project /absolute/project
```

调用前读取选定服务器的说明和工具 schema。切换到另一授权工作树时使用 `--project /absolute/other-worktree`，无需重复配置或编辑模板。CodeGraph 在同一运行时内共享渲染配置等价的实例，避免同一副本出现竞争写入者；不同副本路径仍保持独立。其示例禁用 watcher、daemon 启动及下载，因此同步通过原生流程显式完成。Serena 示例采用公共的独立工具接口，保留客户端实例隔离。已有显式模板/环境覆盖项保持不变，可能改变这些默认行为。含环境/模板标记的字面路径被拒绝，不会解释执行。

数组形式的环境设置保持原样，包括继承的全局数组。配置不会用对象形式的默认值替换它们，也不会把密钥值写入配置。若因此无法添加示例环境默认值，配置会提示在启动前核对原生下载/daemon 行为。即使使用 `--force`，也不会把固定或自定义绑定静默转换为可复用模板。

配置命令不调用依赖安装器或原生初始化命令。运行时已启动时，普通配置重载可能启动静态后端，后端仍保留自身启动行为，并可能写入原生状态。尤其应在启动 Serena 前安装语言依赖：原生依赖获取不受 1MCP 可选准备权限控制。缺少语言依赖不在已验证示例范围内；仅找到可执行文件不代表这些依赖已通过验证。

## 已测支持范围

配置示例在 macOS 26.6.2 arm64、Node.js 26.4.0 上测试，使用 CodeGraph 1.6.2、Code Review Graph 2.3.9 和 Serena 2.0.0（独立工具接口）。Serena 还需要相应语言工具链；已测 TypeScript 组合使用 TypeScript 5.9.3 和 typescript-language-server 5.1.3。其他版本、平台、语言及大型仓库不在此测试范围内。

配置成功不证明索引新鲜度，也不启用自动准备。选项见 [setup 命令参考](/zh/commands/mcp/setup)，复现步骤和证据见[贡献者验证说明](https://github.com/1mcp-app/agent/blob/main/docs/backend-preparation-acceptance.md)。

## 运行时配置（高级）

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

维护自定义辅助脚本时，操作者必须在行为改变后更新 `helperRevision`。可选 `helperFiles` 最多列出八个本地文件，总大小不超过 1 MiB，文件内容哈希参与身份计算。相对声明基于定义文件目录解析。声明的脚本引用和规范脚本路径不能包含保留标记 `{checkout}`、`{operation}` 或 `{input:name}`。作为完整可执行路径或 argv 参数引用的已声明脚本会绑定到规范绝对路径，包括 `helper.cjs` 与 `./helper.cjs` 写法；之后改变符号链接不会重定向已保留的命令。复合参数或解释器源码字符串中的嵌入引用不受支持，会被拒绝；运行时不解析任意解释器代码。静态声明的脚本引用先进行规范路径绑定或拒绝，之后才替换操作者输入；输入值即使等于或包含脚本文件名，也始终按字面保留。

每个保留的适配器拥有自己的预期脚本哈希，在启动命令前和接受探测、进度或动作完成结果前验证。已声明脚本改变或缺失时，探测报告 unknown，动作产生稳定且不可自动重试的 `helper_revision_changed` 失败；不能以旧身份触发 ready 能力刷新。应重新解析更新后的定义并显式重试。这些检查不会冻结外部文件，也不提供原子化的可执行内容快照；已准入任务运行期间仍应保持外部可执行文件与脚本不变。

运行时可显式为命名定义设置 `activation: "setup"`，让新授权副本无需逐项目设置准备偏好。后端 `enabled: false` 和项目显式禁用优先。升级不会自动添加 activation，现有内联配置仍要求项目选择启用。

内置准备定义注册表为空，与上述三个配置示例相互独立。自动准备需要通过公共接口实现并单独验收。本地定义仍是由操作者管理的高级接口；配置示例不表示原生准备缺口已解决。

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
