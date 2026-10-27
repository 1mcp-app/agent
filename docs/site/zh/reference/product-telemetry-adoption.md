---
title: CLI 与管理功能采用情况统计
description: 产品使用遥测中的固定命令分类与运行时管理功能结果。
---

# CLI 与管理功能采用情况统计

本参考用于解读命令与管理功能的聚合计数。采集遵循本机[遥测控制](/zh/commands/telemetry)，不会导出参数、配置名称、请求内容、路由、凭据、诊断上下文或原始错误。

## 命令覆盖范围

每个有效且已注册的短命令处理程序完成后记录一次结果。正常返回或以零状态退出记为成功；抛出异常或非零状态记为失败。嵌套委托和内部实现所启动的子 CLI 进程只记录外层调用。短命令执行期间观测到终止信号时计为失败，并保留原有信号处理行为。解析错误、未知命令、帮助、版本和所有 `telemetry status|enable|disable|reset` 控制均不采集。

接收端使用固定分类。下表中合并的根命令共享聚合计数，报表无法分别展示：

| 注册的根命令                             | 注册的处理程序                                                                                                                                 | 报表分类     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 默认调用、`serve`                        | 启动、后台启动和重启在启动就绪时统计；`--status` 和 `--stop` 在控制操作完成时统计                                                              | `serve`      |
| `proxy`                                  | 启动就绪或启动失败                                                                                                                             | `proxy`      |
| `mcp`                                    | add、setup、install、remove、uninstall、update、enable、disable、restart、list、status、tokens、search；tools 交互模式及 list、enable、disable | `mcp`        |
| `registry`                               | search、status、show、versions                                                                                                                 | `mcp`        |
| `preset`                                 | 根命令交互模式；edit、create、show、list、url、delete、test                                                                                    | `preset`     |
| `project`                                | release、drain、status、resume、recover；prepare 默认操作及 start、inspect、status、wait、cancel、retry                                        | `project`    |
| `bootstrap`                              | 代理钩子指令分发                                                                                                                               | `project`    |
| `auth`                                   | login、status、logout、export-oauth-credentials、export-upstream-credentials                                                                   | `auth`       |
| `admin`                                  | bootstrap、login、status、logout                                                                                                               | `auth`       |
| `app`                                    | consolidate、restore、list、discover、status、backups                                                                                          | `config`     |
| `cli-setup`                              | Shell 设置                                                                                                                                     | `config`     |
| `target`                                 | add、use、export、import、doctor、current、list、inspect、delete、rename、verify                                                               | `config`     |
| `instructions`、`inspect`、`run`、`wait` | 各自的根命令处理程序                                                                                                                           | 与根命令相同 |
| `telemetry`                              | status、enable、disable、reset                                                                                                                 | 不采集       |

`project prepare` 嵌套于 `project`，没有单独注册的根命令 `prepare`。运行时启动和重启保留仅统计启动结果的语义，关闭不会增加命令结果。受监督运行时的自动启动使用独立的 `runtime_start` 功能分类。

命令成功遵循原有退出语义。例如，交互取消若原本以零状态退出，仍计为成功命令，但不代表配置发生变更。

## 管理功能覆盖范围

聚合运行时在共享管理操作的实际执行位置统计已批准的变更，无论调用来自浏览器还是 CLI 管理适配器。CLI 进程还可能记录自身命令分类，但不会因此增加第二次功能或 MCP 操作计数。远程操作由所选远程运行时及其采集策略控制。

| 运行时操作                                     | 功能分类                           |
| ---------------------------------------------- | ---------------------------------- |
| 浏览器管理会话登录成功                         | `admin_open`                       |
| 创建配置服务器                                 | `server_add`                       |
| 编辑配置服务器                                 | `server_update`                    |
| 删除配置服务器                                 | `server_remove`                    |
| 启用或禁用配置服务器，包括确认后的生命周期变更 | `server_enable` / `server_disable` |
| 创建、更新、复制或删除预设                     | `preset_update`                    |
| 创建、更新、克隆、激活、导入或删除指令模板     | `template_update`                  |

`admin_open` 表示浏览器身份验证成功，不会为每次页面、静态资源、会话读取或 CLI 登录计数。使用现有会话重新打开页面不增加计数。登录失败也不增加计数。

变更结果表示共享操作完成或失败。幂等重放、准入或确认被拒绝、预览、验证、读取与试运行均不计数。配置和重载详情留在本地；持久化变更完成不代表后端就绪。不支持的操作（包括后端重启、OAuth 授权及重启、凭据管理）不采集，不会标为无关功能。接收端的 `config_update` 分类目前没有对应的通用管理配置操作。未知功能名称直接拒绝，不存在功能分类 `other`。

## 交付与解读限制

所有统计均为尽力记录。操作系统的强制终止可能完全绕过 JavaScript 完成钩子。立即退出路径会在退出前记录粗粒度结果，但异步准入或持久化可能尚未完成，最终的短命令结果可能丢失。命令不会等待队列、刷新或接收端，正常返回的命令也不会等待发送。重置、禁用和存储容量限制也可能丢弃结果。计数属于观测数据，不是持久审计记录，也不是配置变更的精确次数。

报表保持私有且仅含聚合数据，并区分人工与 CI 活动。本实现不证明已部署接收端兼容、仪表盘访问正常或生产采集已启用；这些需要独立的接收端和部署证据。
