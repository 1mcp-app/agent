---
title: 服务器指令覆盖 - 自定义 LLM 指令
description: 使用字面配置覆盖替换或抑制上游服务器指令，并通过指令模板自定义呈现方式。
---

# 服务器指令覆盖

服务器指令覆盖允许运维人员替换或抑制某个已配置服务器的上游指令，无需在每个指令模板中重复添加针对该服务器的条件逻辑。

## 配置覆盖

在 Admin Console 中打开已配置的服务器，然后选择以下三种状态之一：

| 状态         | 存储值                             | 生效的指令                |
| ------------ | ---------------------------------- | ------------------------- |
| **Upstream** | 不存在 `instructionOverride`       | 使用 MCP 服务器返回的指令 |
| **Replace**  | `instructionOverride` 为非空字符串 | 使用配置文本替换上游指令  |
| **Suppress** | `instructionOverride` 为空字符串   | 不发布该服务器的指令      |

移除覆盖会删除该字段并恢复上游行为。因此，空值表示有意抑制，与移除字段不是同一种操作。仅包含空白字符的值也会被视为字面替换。

覆盖内容是字面文本。1MCP 不会渲染 `instructionOverride` 中的 Handlebars 表达式；例如 `{{title}}` 会原样保留在生效的服务器指令中。

### 静态服务器与模板服务器定义

覆盖属于具体的配置定义，其标识同时包含来源和名称：

- `mcpServers/<name>` 表示静态服务器定义。
- `mcpTemplates/<name>` 表示模板服务器定义。

当静态服务器和模板定义同名时，这种带来源的标识尤其重要。编辑其中一个不会改变另一个。配置在 `mcpTemplates` 定义上的覆盖会由该定义创建的服务器继承，并始终作为字面文本使用；它不会随模板服务器参数展开。

等价的 `mcp.json` 配置如下：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "instructionOverride": "仅使用此服务器访问 /workspace 下的文件。"
    },
    "noisy-server": {
      "command": "noisy-server",
      "instructionOverride": ""
    }
  },
  "mcpTemplates": {
    "tenant-api": {
      "command": "tenant-api",
      "args": ["--tenant", "{{project.name}}"],
      "instructionOverride": "遵循已配置的租户策略。"
    }
  }
}
```

## 优先级与运行时更新

对于每个已配置服务器，1MCP 会先解析其生效的服务器指令：

1. 如果 `instructionOverride` 存在，则使用其值，包括空字符串。
2. 否则，使用服务器返回的上游指令。
3. 应用客户端或预览过滤器，再把生效值提供给活动指令模板。

该解析发生在渲染 `initialization` 或 `cli` 模板之前。因此，两个输出面会看到相同的替换或抑制结果，同时保留各自的输出结构。

修改覆盖后，无需重启后端服务器，后续的指令渲染就会使用新值。已经完成初始化的 MCP 会话不会改变，因为初始化响应已经发送。新连接、Admin 预览以及之后执行的 `1mcp instructions` 会使用更新后的值。

## 模板层自定义

当需要跨多个服务器进行展示逻辑处理，例如分组、排序或添加条件包装文本时，下面的模式仍然适用。它们处理的是已经解析后的生效指令。若只是直接替换或抑制某个已配置服务器，建议使用 `instructionOverride`，这样两个模板变体会共享同一行为。

## 基本服务器指令覆盖模式

### 1. 完全替换服务器指令

您可以用自己的自定义内容替换原始服务器指令：

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{#if (eq name "problematic-server")}}

# {{name}} 的自定义指令

此服务器已使用简化指令进行自定义。
使用这些工具：tool1、tool2、tool3
{{else}}
{{instructions}}
{{/if}}
</{{name}}>
{{/if}}
{{/each}}
```

:::

### 2. 过滤特定服务器

通过添加条件完全跳过某些服务器：

::: v-pre

```markdown
{{#each servers}}
{{#unless (eq name "unwanted-server")}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/unless}}
{{/each}}
```

:::

### 3. 为服务器指令添加前缀或后缀

使用附加上下文增强服务器指令：

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
⚠️ **服务器：{{name}}** - 在生产环境中谨慎使用

{{instructions}}

📝 **注意**：所有 {{name}} 操作都会记录用于审计。
</{{name}}>
{{/if}}
{{/each}}
```

:::

### 4. 基于服务器名称的条件指令

根据服务器类型或命名模式进行不同处理：

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{#if (startsWith name "test-")}}

# 测试环境服务器：{{name}}

⚠️ 这是一个测试服务器。结果可能不可靠。

{{instructions}}
{{else if (startsWith name "prod-")}}

# 生产环境服务器：{{name}}

✅ 这是一个生产服务器。所有操作都受到监控。

{{instructions}}
{{else}}
{{instructions}}
{{/if}}
</{{name}}>
{{/if}}
{{/each}}
```

:::

## 高级覆盖技术

### 1. 服务器指令转换

使用自定义逻辑转换指令：

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{#if (eq name "verbose-server")}}

# 简化的 {{name}} 指令

{{! 用简化版本替换冗长的指令 }}
此服务器提供文件操作。主要工具：

- read_file：读取文件内容
- write_file：写入文件内容
- list_files：列出目录内容
  {{else}}
  {{instructions}}
  {{/if}}
  </{{name}}>
  {{/if}}
  {{/each}}
```

:::

### 2. 合并多个服务器

将多个服务器的指令合并到统一部分：

::: v-pre

```markdown
## 文件操作

{{#each servers}}
{{#if (or (eq name "filesystem") (eq name "storage"))}}
{{#if hasInstructions}}

### {{name}} 功能

{{instructions}}
{{/if}}
{{/if}}
{{/each}}

## 数据库操作

{{#each servers}}
{{#if (or (eq name "database") (eq name "sql"))}}
{{#if hasInstructions}}

### {{name}} 功能

{{instructions}}
{{/if}}
{{/if}}
{{/each}}

## 其他服务

{{#each servers}}
{{#unless (or (eq name "filesystem") (eq name "storage") (eq name "database") (eq name "sql"))}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/unless}}
{{/each}}
```

:::

### 3. 基于优先级的服务器排序

按重要性或偏好重新排序服务器：

::: v-pre

```markdown
## 高优先级服务器

{{#each servers}}
{{#if (or (eq name "critical-server") (eq name "primary-db"))}}
{{#if hasInstructions}}
<{{name}}>
🔥 **高优先级服务器**

{{instructions}}
</{{name}}>
{{/if}}
{{/if}}
{{/each}}

## 标准服务器

{{#each servers}}
{{#unless (or (eq name "critical-server") (eq name "primary-db"))}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/unless}}
{{/each}}
```

:::

## 用于服务器覆盖的 Handlebars 辅助函数

您可以使用这些内置的 Handlebars 辅助函数进行复杂逻辑：

| 辅助函数     | 描述           | 使用示例                                                            |
| ------------ | -------------- | ------------------------------------------------------------------- |
| `eq`         | 相等比较       | <span v-pre>`{{#if (eq name "server1")}}`</span>                    |
| `ne`         | 不等比较       | <span v-pre>`{{#if (ne name "server1")}}`</span>                    |
| `or`         | 逻辑或         | <span v-pre>`{{#if (or (eq name "a") (eq name "b"))}}`</span>       |
| `and`        | 逻辑与         | <span v-pre>`{{#if (and hasInstructions (ne name "skip"))}}`</span> |
| `startsWith` | 字符串开头匹配 | <span v-pre>`{{#if (startsWith name "test-")}}`</span>              |
| `endsWith`   | 字符串结尾匹配 | <span v-pre>`{{#if (endsWith name "-dev")}}`</span>                 |
| `contains`   | 字符串包含     | <span v-pre>`{{#if (contains instructions "deprecated")}}`</span>   |

## 实际覆盖示例

### 示例 1：特定环境指令

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{#if (endsWith name "-dev")}}

# 开发环境：{{name}}

⚠️ **开发模式**：此服务器仅用于开发。

{{instructions}}

**开发注意事项：**

- 调试已启用
- 所有操作都会详细记录
- 数据可能每天重置
  {{else if (endsWith name "-prod")}}

# 生产环境：{{name}}

✅ **生产环境**：此服务器处理实时数据。

{{instructions}}

**生产准则：**

- 所有操作都会被审计
- 强制执行速率限制
- 遵循安全协议
  {{else}}
  {{instructions}}
  {{/if}}
  </{{name}}>
  {{/if}}
  {{/each}}
```

:::

### 示例 2：服务器功能分组

::: v-pre

```markdown
# 按类别分类的服务器功能

## 数据存储和检索

{{#each servers}}
{{#if (or (contains name "db") (contains name "storage") (contains name "file"))}}
{{#if hasInstructions}}

### {{name}}

{{instructions}}
{{/if}}
{{/if}}
{{/each}}

## 通信和网络

{{#each servers}}
{{#if (or (contains name "web") (contains name "api") (contains name "http"))}}
{{#if hasInstructions}}

### {{name}}

{{instructions}}
{{/if}}
{{/if}}
{{/each}}

## 处理和计算

{{#each servers}}
{{#unless (or (contains name "db") (contains name "storage") (contains name "file") (contains name "web") (contains name "api") (contains name "http"))}}
{{#if hasInstructions}}

### {{name}}

{{instructions}}
{{/if}}
{{/unless}}
{{/each}}
```

:::

## 测试您的模板覆盖

要测试您的模板覆盖并确保它们正常工作：

### 1. 创建测试模板

创建一个简单的测试模板来验证您的覆盖逻辑：

::: v-pre

```markdown
# 模板测试

{{#if hasServers}}
发现 {{serverCount}} 个带有指令的服务器。

{{#each servers}}
服务器：{{name}}（有指令：{{hasInstructions}}）
{{#if hasInstructions}}
指令长度：{{instructions.length}} 字符
{{/if}}

{{/each}}
{{else}}
未找到服务器。
{{/if}}
```

:::

### 2. 使用 CLI 测试

将您的模板保存到文件并测试：

```bash
# 创建测试模板
echo "{{#each servers}}{{name}}: {{hasInstructions}}{{/each}}" > test-template.md

# 使用您的模板测试
1mcp serve --instructions-template test-template.md

# 连接客户端查看渲染输出
```

### 3. 验证步骤

1. **语法检查**：确保 Handlebars 语法有效
2. **逻辑验证**：使用不同的服务器配置测试条件逻辑
3. **边缘情况**：测试无服务器、单个服务器、没有指令的服务器
4. **性能**：监控多个服务器时的渲染时间

### 4. 常见测试场景

针对这些常见场景测试您的模板：

- **无服务器连接**：模板应优雅地处理空状态
- **混合服务器类型**：一些有指令，一些没有
- **长指令**：确保格式保持可读
- **特殊字符**：测试包含特殊字符的服务器名称
- **多种环境**：测试 dev/staging/prod 服务器命名模式

## 服务器指令覆盖技巧

1. **测试您的逻辑**：先使用简单条件，然后构建复杂性
2. **保留原始内容**：考虑保持原始指令可用并进行修改
3. **使用注释**：Handlebars 注释 <span v-pre>`{{! comment }}`</span> 有助于记录您的逻辑
4. **验证服务器名称**：检查服务器名称是否符合您期望的模式
5. **处理边缘情况**：考虑没有指令或意外名称的服务器
6. **性能**：模板中的复杂逻辑在服务器数量多时可能减慢渲染速度
7. **文档**：为团队成员记录您的覆盖逻辑
8. **版本控制**：将模板保存在版本控制中以跟踪更改

## 模板问题排查

### 常见问题和解决方案

1. **模板未加载**：检查文件路径和权限
2. **语法错误**：使用验证器验证 Handlebars 语法
3. **逻辑不工作**：逐步测试各个条件
4. **性能问题**：简化复杂的嵌套循环
5. **输出格式**：检查额外的空白或缺少的换行符

### 调试模板变量

使用此调试模板检查可用变量：

::: v-pre

```markdown
# 调试模板

## 可用变量

- serverCount: {{serverCount}}
- hasServers: {{hasServers}}
- serverList: {{serverList}}
- toolPattern: {{toolPattern}}
- title: {{title}}

## 服务器详情

{{#each servers}}

### 服务器 {{@index}}：{{name}}

- 有指令：{{hasInstructions}}
- 指令长度：{{instructions.length}}
  {{#if hasInstructions}}
- 前 100 个字符：{{substring instructions 0 100}}...
  {{/if}}

{{/each}}
```

:::

此模板将帮助您了解哪些数据可用以及它们的结构。
