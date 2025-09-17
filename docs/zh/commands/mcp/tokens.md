# mcp tokens

通过连接到服务器并分析其工具、资源和提示来估算 MCP 令牌使用量。

有关服务器管理的完整概述，请参阅 **[服务器管理指南](../../guide/essentials/server-management)**。

## 摘要

```bash
npx -y @1mcp/agent mcp tokens [options]
```

## 选项

- **`--model, -m <model>`**
  - 用于令牌估算的模型（默认：`gpt-4o`）
  - 支持任何有效的 tiktoken 模型，包括 `gpt-3.5-turbo`、`gpt-4`、`o1` 等

- **`--preset, -p <name>`**
  - 使用预设过滤器而非手动标签表达式
  - 不能与 `--tag-filter` 同时使用

- **`--tag-filter, -f <expression>`**
  - 通过高级标签表达式过滤服务器（and/or/not 逻辑）
  - 示例：`network`、`web+api`、`(filesystem,network)-test`
  - 不能与 `--preset` 同时使用

- **`--format <format>`**
  - 输出格式：`table`、`json`、`summary`（默认：`table`）

- **`--verbose, -v`**
  - 显示服务器日志和连接详情
  - 默认情况下，服务器日志被抑制以获得清洁的输出

- **`--config, -c <path>`**
  - 配置文件路径

## 描述

`mcp tokens` 命令连接到您配置的 MCP 服务器并分析其功能以估算令牌使用量。这对以下用途很有用：

- **成本规划**：估算使用不同语言模型时的令牌成本
- **性能分析**：了解哪些服务器对令牌使用量贡献最大
- **优化**：识别减少令牌消耗的机会
- **调试**：分析服务器连接性和功能加载情况

该命令使用 tiktoken 根据指定模型进行准确的令牌化，对无效模型具有自动回退处理功能。

## 示例

```bash
# 使用默认模型（gpt-4o）估算所有 MCP 服务器的令牌
npx -y @1mcp/agent mcp tokens

# 使用不同模型进行令牌估算
npx -y @1mcp/agent mcp tokens --model gpt-3.5-turbo

# 使用预设进行服务器过滤
npx -y @1mcp/agent mcp tokens --preset development

# 按标签过滤服务器并显示摘要格式
npx -y @1mcp/agent mcp tokens --tag-filter="network or filesystem" --format=summary

# 导出详细分析为 JSON 格式用于程序化使用
npx -y @1mcp/agent mcp tokens --format=json > token-analysis.json

# 使用特定模型进行复杂标签过滤
npx -y @1mcp/agent mcp tokens --model=o1 --tag-filter="(web+api)-test" --format=table

# 显示服务器日志和连接详情用于调试
npx -y @1mcp/agent mcp tokens --verbose

# 使用自定义配置文件
npx -y @1mcp/agent mcp tokens --config ~/my-mcp-config.json
```

## 输出格式

### 表格格式（默认）

按功能类型（工具、资源、提示）显示美观格式化的彩色分层细分，包含服务器分组和每个项目的令牌估算。输出使用：

- **彩色区段** 带有视觉图标（🔧 工具、📁 资源、💬 提示）
- **框式摘要** 包含整体统计信息
- **清洁布局** 默认抑制服务器日志
- **连接状态** 每个服务器的状态清晰标示

### JSON 格式

提供适用于程序化分析的结构化数据：

```json
{
  "summary": {
    "totalServers": 5,
    "connectedServers": 4,
    "totalTools": 25,
    "overallTokens": 8450
  },
  "servers": [
    {
      "serverName": "filesystem",
      "connected": true,
      "breakdown": {
        "tools": [...],
        "totalTokens": 1200
      }
    }
  ]
}
```

### 摘要格式

简洁的概览，包含关键指标和按令牌使用量排序的顶级服务器，以彩色框式区段呈现：

- **使用摘要** 包含服务器计数和功能总计
- **顶级服务器排名** 按令牌消耗排序
- **连接问题** 如有服务器宕机会清晰突出显示

## 支持的模型

`--model` 选项接受任何有效的 tiktoken 模型：

- **GPT-4 系列**：`gpt-4o`、`gpt-4`、`gpt-4-turbo`
- **GPT-3.5 系列**：`gpt-3.5-turbo`、`gpt-3.5-turbo-16k`
- **O1 系列**：`o1`、`o1-mini`、`o1-preview`
- **旧版模型**：`text-davinci-003`、`code-davinci-002`

如果指定了无效模型，命令会自动回退到 `gpt-4o` 并显示警告。

## 错误处理

- **服务器连接失败**：在输出中显示错误详情
- **无效模型名称**：自动回退到 `gpt-4o`
- **配置问题**：清晰的错误消息和建议的修复方法
- **权限错误**：身份验证问题的有用指导

## 另请参阅

- **[服务器管理指南](../../guide/essentials/server-management)**
- **[mcp status](./status)** - 检查服务器连接性
- **[mcp list](./list)** - 列出已配置的服务器
