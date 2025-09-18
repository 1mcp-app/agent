# 模板示例

本页面为不同用例提供完整的模板示例。复制并自定义这些模板以满足您的特定需求。

## 模板渲染行为

**重要**: 1MCP 在 Handlebars 配置中使用 `noEscape: true`，这意味着：

- 所有变量默认输出未转义内容
- 像 `<server-name>` 这样的 XML 标签清晰渲染，无需 HTML 实体转义
- 所有内容使用常规 `{{variable}}` 语法（无需三重括号）
- 非常适合 LLM 消费，其中可读性和正确的格式至关重要

## 基本模板

一个简单、清晰的模板，涵盖基本要素。此示例演示了新的增强服务器迭代：

```
# 我的 MCP 网关

## 连接的服务器

我们有 3 个服务器连接：
- api-server
- database-server
- web-server

## 服务器指令

每个服务器提供特定功能。指令使用 XML 样式标签组织以便清晰识别：

### api-server 服务器
<api-server>
用于后端服务的 API 服务器指令
</api-server>

### database-server 服务器
<database-server>
用于数据管理的数据库服务器指令
</database-server>

### web-server 服务器
<web-server>
用于前端开发的网页服务器指令
</web-server>

## 使用方法

所有工具都使用模式 `{server}_1mcp_{tool}` 可用

示例工具：
- `filesystem_1mcp_read_file` - 通过文件系统服务器读取文件
- `web_1mcp_search` - 通过网页服务器搜索网页
- `database_1mcp_query` - 通过数据库服务器查询数据库
```

## 增强模板功能

### 单个服务器迭代

新的模板系统提供两种显示服务器信息的方式：

1. **简单列表**: 使用 `serverNames` 变量进行基本服务器列表
2. **详细对象**: 使用 `servers` 数组获得最大灵活性和条件逻辑

### 模板变量参考

#### 服务器数组

- `serverNames` - 用于简单迭代的服务器名称数组
- `servers` - 包含详细信息的服务器对象数组

`servers` 数组中的每个服务器对象包含：

- `name` - 服务器名称（例如 "api-server"）
- `instructions` - 服务器指令内容
- `hasInstructions` - 此服务器是否有指令

#### XML 标签文档

始终向 LLM 解释 XML 样式标签的含义：

- **目的**: 标识哪个服务器提供哪些指令
- **格式**: `<server-name>指令内容</server-name>`
- **优势**: 不同服务器功能之间的清晰边界
- **LLM 理解**: 帮助 LLM 正确路由请求

### 模板模式示例

#### 基本服务器列表

```
连接的服务器：
- api-server
- database-server
- web-server
```

#### 带条件的服务器详细信息

```
### api-server 服务器
已连接并就绪

#### api-server 可以做什么
<api-server>
用于后端服务的 API 服务器指令
</api-server>

### database-server 服务器
已连接并就绪

#### database-server 可以做什么
<database-server>
用于数据管理的数据库服务器指令
</database-server>
```

## 使用技巧

1. **复制并自定义**: 从基本模式开始，根据您的需求进行定制
2. **迭代测试**: 进行小更改并使用不同的服务器配置进行测试
3. **处理边缘情况**: 始终包含已连接和无服务器两种情况
4. **使用常规语法**: 所有变量使用 `{{variable}}` 语法 - 由于 `noEscape: true` 无需三重括号
5. **XML 标签清晰渲染**: 带有 `<server-name>` 标签的服务器指令按原样输出，实现完美的 LLM 可读性
6. **检查日志**: 在开发过程中监控模板渲染日志
