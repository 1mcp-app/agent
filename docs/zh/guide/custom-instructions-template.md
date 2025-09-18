# 自定义指令模板

1MCP 允许您自定义发送给 LLM 客户端的指令模板。这使您能够为代理添加品牌标识、提供自定义文档，或针对特定用例定制教育内容。

## 概述

默认情况下，1MCP 会生成教育性指令模板，帮助 LLM 了解如何有效使用代理。您可以使用自己的 Handlebars 模板覆盖此模板，包括：

- 自定义品牌和消息
- 针对您用例的具体指令
- 使用实时服务器数据进行变量替换
- 基于连接服务器的条件内容

## 模板变量

您的自定义模板可以访问以下变量：

### 服务器状态变量

| 变量                                   | 类型    | 描述                          | 示例                                                                 |
| -------------------------------------- | ------- | ----------------------------- | -------------------------------------------------------------------- |
| <span v-pre>`{{serverCount}}`</span>   | number  | 连接且有指令的服务器数量      | `3`                                                                  |
| <span v-pre>`{{hasServers}}`</span>    | boolean | 是否有任何服务器连接          | `true`                                                               |
| <span v-pre>`{{serverList}}`</span>    | string  | 服务器名称的换行分隔列表      | `"api-server\nweb-server"`                                           |
| <span v-pre>`{{serverNames}}`</span>   | array   | 用于迭代的服务器名称数组      | `["api-server", "web-server"]`                                       |
| <span v-pre>`{{servers}}`</span>       | array   | 用于详细迭代的服务器对象数组  | `[{name: "api-server", instructions: "...", hasInstructions: true}]` |
| <span v-pre>`{{pluralServers}}`</span> | string  | 基于数量的"server"或"servers" | `"servers"`                                                          |
| <span v-pre>`{{isAre}}`</span>         | string  | 基于数量的"is"或"are"         | `"are"`                                                              |

#### 服务器对象（<span v-pre>`{{servers}}`</span> 数组）

<span v-pre>`{{servers}}`</span> 数组中的每个服务器对象包含：

| 属性              | 类型    | 描述                            |
| ----------------- | ------- | ------------------------------- |
| `name`            | string  | 服务器名称（例如 "api-server"） |
| `instructions`    | string  | 服务器的指令内容                |
| `hasInstructions` | boolean | 此服务器是否有指令              |

### 内容变量

| 变量                                   | 类型   | 描述                                                |
| -------------------------------------- | ------ | --------------------------------------------------- |
| <span v-pre>`{{instructions}}`</span>  | string | 包装在 XML 样式标签中的所有服务器指令（未转义输出） |
| <span v-pre>`{{filterContext}}`</span> | string | 过滤器描述或空字符串                                |

#### XML 样式服务器指令

服务器指令被包装在 XML 样式标签中，以清楚地标识其来源和范围：

```xml
<server-name>
服务器指令内容在此
</server-name>
```

这种格式有助于 LLM 理解哪些指令来自哪个服务器，并维护不同服务器功能之间的清晰边界。

### 配置变量

| 变量                                 | 类型   | 描述         | 默认值                                                                 |
| ------------------------------------ | ------ | ------------ | ---------------------------------------------------------------------- |
| <span v-pre>`{{title}}`</span>       | string | 模板的标题   | `"1MCP - Model Context Protocol Proxy"`                                |
| <span v-pre>`{{toolPattern}}`</span> | string | 工具命名模式 | `"{server}_1mcp_{tool}"`                                               |
| <span v-pre>`{{examples}}`</span>    | array  | 工具示例数组 | 参见[示例参考](/zh/reference/instructions-template/variables#examples) |

## 使用自定义模板

### 命令行选项

使用 serve 命令的 `--instructions-template` 选项：

```bash
# 使用特定的模板文件
1mcp serve --instructions-template ./my-template.md

# 使用配置目录中的默认模板
1mcp serve  # 在配置目录中查找 instructions-template.md
```

### 模板文件位置

默认情况下，1MCP 会在您的配置目录中查找 `instructions-template.md`：

- **macOS/Linux**: `~/.config/1mcp/instructions-template.md`
- **Windows**: `%APPDATA%/1mcp/instructions-template.md`

您也可以使用 CLI 选项指定自定义路径。

### 配置覆盖

您还可以通过扩展配置系统在每个客户端的 MCP 服务器配置中包含模板选项来覆盖模板设置。

## 模板语法

1MCP 使用 [Handlebars](https://handlebarsjs.com/) 作为模板引擎，提供以下功能：

- **变量替换**: <span v-pre>`{{variable}}`</span>
- **条件内容**: <span v-pre>`{{#if condition}}...{{/if}}`</span>
- **循环**: <span v-pre>`{{#each array}}...{{/each}}`</span>
- **辅助函数**: 内置逻辑和比较运算符

### HTML 转义行为

**重要**: 1MCP 默认配置 Handlebars 时使用 `noEscape: true`，这意味着：

- **所有变量都未转义**: <span v-pre>`{{instructions}}`</span> 输出原始内容而不进行 HTML 实体转义
- **XML 标签清晰渲染**: `<server-name>` 保持为 `<server-name>`（不是 `&lt;server-name&gt;`）
- **无需三重括号**: 所有内容使用常规 <span v-pre>`{{variable}}`</span> 语法
- **适合 LLM 消费**: 输出清晰且易于 AI 处理

这种配置专门为 LLM 指令模板设计，HTML 转义会使内容可读性降低且更难被 AI 模型解析。

### 基本模板示例

::: v-pre

```markdown
# {{title}}

{{#if hasServers}}
You have {{serverCount}} {{pluralServers}} connected:

{{#each serverNames}}

- ✅ {{this}}
  {{/each}}

## Server Instructions

The following sections contain instructions from each connected MCP server. Each server's instructions are wrapped in XML-like tags to clearly identify their source and scope.

{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>

{{/if}}
{{/each}}

## Tool Usage

Tools follow the pattern: `{{toolPattern}}`
{{else}}
⏳ No servers are currently connected.
{{/if}}
```

:::

### 高级模板示例

::: v-pre

```markdown
# {{title}}

{{#if hasServers}}
You are interacting with 1MCP, a proxy server that aggregates capabilities from multiple MCP (Model Context Protocol) servers. 1MCP acts as a unified gateway, allowing you to access tools and resources from various specialized MCP servers through a single connection.

## How 1MCP Works

- **Unified Access**: Connect to multiple MCP servers through one proxy
- **Tool Aggregation**: All tools are available with the naming pattern \`{{toolPattern}}\`
- **Resource Sharing**: Access files, data, and capabilities across different servers
- **Intelligent Routing**: Your requests are automatically routed to the appropriate servers

## Currently Connected Servers

{{serverCount}} MCP {{pluralServers}} {{isAre}} currently available{{filterContext}}:

{{serverList}}

## Available Capabilities

All tools from connected servers are accessible using the format: \`{{toolPattern}}\`

Examples:
{{#each examples}}

- \`{{name}}\` - {{description}}
  {{/each}}

## Server-Specific Instructions

The following sections contain instructions from each connected MCP server. Each server's instructions are wrapped in XML-like tags (e.g., \`<server-name>instructions</server-name>\`) to clearly identify their source and scope.

{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>

{{/if}}
{{/each}}

## Tips for Using 1MCP

- Tools are namespaced by server to avoid conflicts

{{else}}
You are interacting with 1MCP, a proxy server that aggregates capabilities from multiple MCP (Model Context Protocol) servers.

## Current Status

No MCP servers are currently connected. 1MCP is ready to connect to servers and provide unified access to their capabilities once they become available.

## What 1MCP Provides

- **Unified Access**: Connect to multiple MCP servers through one proxy
- **Tool Aggregation**: Access tools using the pattern \`{{toolPattern}}\`
- **Resource Sharing**: Share files, data, and capabilities across servers
- **Intelligent Routing**: Automatic request routing to appropriate servers

1MCP will automatically detect and connect to available MCP servers. Once connected, their tools and capabilities will become available through the unified interface.
{{/if}}`
```

:::

## 模板最佳实践

### 1. 使用条件内容

在显示服务器特定内容之前始终检查服务器是否可用：

```text
{{#if hasServers}}
  <!-- 服务器特定内容 -->
{{else}}
  <!-- 无服务器消息 -->
{{/if}}
```

### 2. 处理复数形式

使用提供的辅助变量进行正确的语法：

```text
{{serverCount}} 个 {{pluralServers}} {{isAre}} 可用
```

### 3. 所有变量都未转义

由于 1MCP 使用 `noEscape: true`，所有变量都输出原始内容而不进行 HTML 转义：

```text
{{instructions}}    <!-- 输出原始内容（未转义） -->
{{name}}           <!-- 按原样输出服务器名称 -->
{{title}}          <!-- 所有变量渲染时都不转义 -->
```

这意味着像 `<server-name>` 这样的 XML 标签将在输出中清晰渲染，非常适合 LLM 消费。

### 4. 提供上下文

包含有关过滤的信息（当激活时）：

```text
{{serverCount}} 个服务器可用{{filterContext}}
```

### 5. 使用单个服务器迭代

为获得最大灵活性，迭代单个服务器而不是使用连接的指令：

```text
{{#each servers}}
{{#if hasInstructions}}
### {{name}} 功能
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/each}}
```

这使您可以控制每个服务器的格式、条件包含和自定义逻辑。

### 6. 解释 XML 标签格式

通过提供上下文帮助 LLM 理解 XML 标签结构：

```text
## 服务器指令

每个服务器的指令都包装在 XML 样式标签中（例如 `<server-name>content</server-name>`），以清楚地标识其来源和范围。
```

### 7. 使其有帮助

包含示例和使用技巧，帮助 LLM 理解您的特定设置：

```text
{{#each examples}}
- `{{name}}` - {{description}}
{{/each}}
```

## 错误处理

如果您的自定义模板有语法错误或渲染失败：

1. **回退**: 1MCP 自动回退到默认模板
2. **日志记录**: 错误被记录用于调试
3. **验证**: 模板编译错误被捕获并报告

## 测试模板

您可以通过以下方式测试模板：

1. **启动服务器**: 使用您的模板并检查日志
2. **连接客户端**: 验证指令是否正确渲染
3. **使用不同的过滤器**: 使用各种服务器组合进行测试
4. **检查边缘情况**: 测试无服务器、单个服务器等情况

## 模板示例

有关不同用例的完整模板示例，请参见[模板示例](/zh/reference/instructions-template/examples)页面。
