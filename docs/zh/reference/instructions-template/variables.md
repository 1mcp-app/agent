# 模板变量参考

本页面提供了自定义指令模板中所有可用变量的完整参考。

## HTML 转义行为

**重要**: 1MCP 默认配置 Handlebars 时使用 `noEscape: true`，这意味着所有模板变量都输出未转义的内容。这专门为 LLM 指令模板设计，HTML 转义会干扰可读性和 AI 解析。

- **所有变量都未转义**: 所有内容使用常规 <span v-pre>`{{variable}}`</span> 语法
- **XML 标签清晰渲染**: `<server-name>` 输出为 `<server-name>`（不是 HTML 实体）
- **无需三重括号**: <span v-pre>`{{instructions}}`</span> 直接输出原始内容

## 服务器状态变量

### <span v-pre>`{{serverCount}}`</span>

- **类型**: `number`
- **描述**: 连接且有指令的服务器数量
- **示例**: `3`
- **注意**: 仅计算具有非空指令的服务器

### <span v-pre>`{{hasServers}}`</span>

- **类型**: `boolean`
- **描述**: 是否有任何有指令的服务器连接
- **示例**: `true`
- **用法**: 模板逻辑的主要条件

### <span v-pre>`{{serverList}}`</span>

- **类型**: `string`
- **描述**: 服务器名称的换行分隔列表（字母顺序）
- **示例**: `"api-server\ndatabase-server\nweb-server"`
- **用法**: 用于简单文本列表

### <span v-pre>`{{serverNames}}`</span>

- **类型**: `array<string>`
- **描述**: 用于迭代的服务器名称数组
- **示例**: `["api-server", "database-server", "web-server"]`
- **用法**: 与 <span v-pre>`{{#each}}`</span> 辅助函数一起用于自定义格式化

### <span v-pre>`{{servers}}`</span>

- **类型**: `array<ServerData>`
- **描述**: 用于详细迭代和条件逻辑的服务器对象数组
- **结构**:
  ```typescript
  interface ServerData {
    name: string; // 服务器名称（例如 "api-server"）
    instructions: string; // 服务器指令内容
    hasInstructions: boolean; // 此服务器是否有指令
  }
  ```
- **用法**: 与 <span v-pre>`{{#each}}`</span> 一起使用以获得最大的模板灵活性
- **示例**:

::: v-pre

```text
{{#each servers}}
{{#if hasInstructions}}
### {{name}} 服务器
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/each}}
```

:::

### <span v-pre>`{{pluralServers}}`</span>

- **类型**: `string`
- **描述**: 语法正确的单数/复数形式
- **值**: `"server"`（数量 = 1）或 `"servers"`（数量 ≠ 1）
- **示例**: `"servers"`

### <span v-pre>`{{isAre}}`</span>

- **类型**: `string`
- **描述**: 语法正确的动词形式
- **值**: `"is"`（数量 = 1）或 `"are"`（数量 ≠ 1）
- **示例**: `"are"`

## 内容变量

### <span v-pre>`{{instructions}}`</span>

- **类型**: `string`（未转义）
- **描述**: 包装在 XML 样式标签中的所有服务器指令
- **格式**: `<server-name>\n指令...\n</server-name>`
- **用法**: 使用常规 <span v-pre>`{{instructions}}`</span> 语法（默认未转义）
- **示例**:

  ```xml
  <api-server>
  用于后端服务的 API 服务器指令
  </api-server>

  <web-server>
  用于前端开发的网页服务器指令
  </web-server>
  ```

### <span v-pre>`{{filterContext}}`</span>

- **类型**: `string`
- **描述**: 活动过滤的描述，如果没有则为空字符串
- **示例**:
  - `""`（无过滤）
  - `" (按标签过滤: backend, api)"`
  - `" (按高级表达式过滤)"`
  - `" (按预设过滤)"`

## 配置变量

### <span v-pre>`{{title}}`</span>

- **类型**: `string`
- **描述**: 指令模板的标题
- **默认值**: `"1MCP - Model Context Protocol Proxy"`
- **可自定义**: 可以在配置中覆盖
- **示例**: `"我的自定义 MCP 网关"`

### <span v-pre>`{{toolPattern}}`</span>

- **类型**: `string`
- **描述**: 代理使用的工具命名模式
- **默认值**: `"{server}_1mcp_{tool}"`
- **可自定义**: 可以在配置中覆盖
- **示例**: `"{server}::{tool}"`

### <span v-pre>`{{examples}}`</span>

- **类型**: `array<ToolExample>`
- **描述**: 用于文档的工具示例数组
- **结构**:
  ```typescript
  interface ToolExample {
    name: string; // 应用了模式的工具名称
    description: string; // 工具的功能
  }
  ```

#### 默认示例 {#default-examples}

| 工具名称                    | 描述                       |
| --------------------------- | -------------------------- |
| `filesystem_1mcp_read_file` | 通过文件系统服务器读取文件 |
| `web_1mcp_search`           | 通过网页服务器搜索网页     |
| `database_1mcp_query`       | 通过数据库服务器查询数据库 |

#### 自定义示例

您可以在配置中提供自定义示例：

```json
{
  "examples": [
    {
      "name": "custom_1mcp_analyze",
      "description": "通过自定义服务器分析数据"
    },
    {
      "name": "monitor_1mcp_check",
      "description": "通过监控服务器检查系统健康"
    }
  ]
}
```

## 变量使用示例

### 基本替换

::: v-pre

```text
连接到 {{serverCount}} 个 {{pluralServers}}
```

:::

输出: `连接到 3 个服务器`

### 条件内容

::: v-pre

```text
{{#if hasServers}}
  {{serverCount}} 个 {{pluralServers}} {{isAre}} 就绪
{{else}}
  没有连接服务器
{{/if}}
```

:::

### 服务器迭代（简单）

::: v-pre

```text
{{#each serverNames}}
- 服务器: {{this}}
{{/each}}
```

:::

### 服务器迭代（详细）

::: v-pre

```text
{{#each servers}}
{{#if hasInstructions}}
#### {{name}} 功能
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/each}}
```

:::

### 工具示例

::: v-pre

```text
可用工具:
{{#each examples}}
- `{{name}}`: {{description}}
{{/each}}
```

:::

### 复杂模板

::: v-pre

```text
# {{title}}

## 状态: {{#if hasServers}}✅ 活跃{{else}}⏳ 等待中{{/if}}

{{#if hasServers}}
**{{serverCount}} 个 {{pluralServers}} 已连接**{{filterContext}}

### 服务器
{{#each serverNames}}
- 🔧 {{this}}
{{/each}}

### 指令
{{instructions}}

### 示例工具
{{#each examples}}
- `{{name}}` - {{description}}
{{/each}}

*工具使用模式: `{{toolPattern}}`*
{{else}}
等待服务器连接...
{{/if}}
```

:::

## 变量范围和上下文

### 过滤影响

当过滤激活时，只有变量反映过滤的子集：

- <span v-pre>`{{serverCount}}`</span> = 过滤后的服务器数量
- <span v-pre>`{{serverNames}}`</span> = 仅过滤后的服务器名称
- <span v-pre>`{{instructions}}`</span> = 仅来自过滤后服务器的指令
- <span v-pre>`{{filterContext}}`</span> = 活动过滤器的描述

### 字母顺序

服务器相关变量保持一致的字母顺序：

- <span v-pre>`{{serverList}}`</span> 按字母顺序排序
- <span v-pre>`{{serverNames}}`</span> 数组按字母顺序排序
- <span v-pre>`{{instructions}}`</span> 部分按字母顺序出现

### 实时更新

所有变量都反映当前状态：

- 服务器连接/断开更新计数
- 指令更改更新内容
- 过滤更改更新所有相关变量

## 错误处理

### 缺失变量

- 未定义的变量渲染为空字符串
- 模板引擎继续处理
- 缺失变量不会抛出错误

### 无效模板

- 语法错误导致回退到默认模板
- 错误被记录但不会导致服务器崩溃
- 模板编译被缓存以提高性能

### 模板渲染

**注意**: 1MCP 使用 `noEscape: true` 配置，因此所有变量默认未转义：

- <span v-pre>`{{variable}}`</span> 输出原始内容（未转义）
- 无需三重括号 - 所有内容按原样渲染
- 非常适合 LLM 消费，XML 标签和标记应被保留
- 不需要 XSS 保护，因为模板用于 LLM 指令目的，而不是网页显示
