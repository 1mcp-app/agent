# mcp status

检查已配置的 MCP 服务器的状态和详细信息。

有关服务器管理的完整概述，请参阅 **[服务器管理指南](../../guide/essentials/server-management)**。

## 摘要

```bash
npx -y @1mcp/agent mcp status [name] [options]
```

## 参数

- **`[name]`**
  - 要检查的特定服务器的名称。如果省略，则检查所有服务器。

## 全局选项

此命令支持所有全局选项：

- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径

## 命令特定选项

- **`--verbose, -v`**
  - 显示详细配置以及每个活动模板实例。未指定时，模板状态按实例状态聚合显示。

## 描述

此命令将已配置目标与所选聚合运行时的实时信息合并展示。运行时可用时，会报告 `connected`、`restarting`、`crash-loop` 等监督状态，以及重试次数与上限、下次重试时间、最近退出与错误、当前子进程 PID。

输出同时包含 `mcpServers` 和 `mcpTemplates`。查看全部目标时，即使每个模板实例使用不同的运行时键，也会按模板声明名称聚合。查看单个模板时，默认只显示活动实例数和状态汇总；使用 `--verbose` 后才逐个显示 12 位实例短 ID 及监督信息。

运行时查询使用当前运行时目标上下文（Runtime Target Context）。如果无法发现运行时，配置状态仍会正常输出，运行时状态显示为未知。

## 示例

```bash
# 检查所有服务器的状态
npx -y @1mcp/agent mcp status

# 检查特定服务器的状态
npx -y @1mcp/agent mcp status my-server

# 获取详细的状态信息
npx -y @1mcp/agent mcp status --verbose

# 查看某个模板的全部活动实例
npx -y @1mcp/agent mcp status github --verbose
```

## 另请参阅

- **[服务器管理指南](../../guide/essentials/server-management)**
