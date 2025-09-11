# preset create

使用过滤表达式进行命令行预设创建。

有关预设管理的完整概述，请参阅 **[预设命令概述](./index)**。

## 概要

```bash
npx -y @1mcp/agent preset create <name> --filter <expression> [options]
```

## 参数

- **`<name>`**
  - 新预设的唯一名称。
  - **必需**：是
  - **格式**：仅限字母、数字、连字符和下划线

## 全局选项

此命令支持所有全局选项：

- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径

## 命令特定选项

- **`--filter, -f <expression>`**
  - 服务器选择的过滤表达式。
  - **必需**：是
  - **格式**：简单的逗号分隔或复杂的布尔表达式

- **`--description, -d <description>`**
  - 预设的可选描述。
  - **必需**：否

## 描述

`preset create` 命令允许您使用过滤表达式从命令行快速创建预设。这非常适合自动化、脚本编写以及确切知道要包含哪些服务器的用户。

### 过滤表达式格式

#### 简单（逗号分隔 = OR 逻辑）

```bash
--filter "web,api,database"
# 匹配具有 web OR api OR database 标签的服务器
```

#### 布尔表达式

```bash
# AND 逻辑
--filter "web AND database"

# 带括号的复杂表达式
--filter "(web OR api) AND database AND NOT experimental"

# 多条件分组
--filter "(frontend OR backend) AND (dev OR staging)"
```

#### 表达式运算符

- **`,`**（逗号）：OR 逻辑（仅限简单格式）
- **`AND`**：所有条件必须匹配
- **`OR`**：任何条件都可以匹配
- **`NOT`**：排除匹配的服务器
- **`()`**：对条件进行分组以确定优先级

## 示例

### 简单 OR 过滤器

```bash
# 具有 web、api 或 database 的开发服务器
npx -y @1mcp/agent preset create development --filter "web,api,database"

# 测试服务器
npx -y @1mcp/agent preset create testing --filter "test,staging,qa"
```

### AND 逻辑过滤器

```bash
# 同时具有 web 和 database 的生产服务器
npx -y @1mcp/agent preset create production --filter "web AND database"

# 受监控的 web 服务
npx -y @1mcp/agent preset create monitored-web --filter "web AND monitoring"
```

### 复杂布尔表达式

```bash
# 安全的生产环境
npx -y @1mcp/agent preset create secure-prod \
  --filter "web AND database AND NOT experimental" \
  --description "排除实验性功能的生产服务器"

# 跨职能开发团队
npx -y @1mcp/agent preset create fullstack-dev \
  --filter "(frontend OR backend) AND development"

# 多环境排除
npx -y @1mcp/agent preset create staging-safe \
  --filter "(staging OR test) AND NOT deprecated"
```

### 带描述

```bash
# 为团队共享添加有意义的描述
npx -y @1mcp/agent preset create team-prod \
  --filter "web AND database AND monitoring" \
  --description "具有完整监控功能的团队生产环境"
```

## 过滤表达式参考

### 标签匹配

```bash
# 单个标签
"web"

# 多个标签（OR）
"web,api,database"
"web OR api OR database"  # 等效
```

### 逻辑运算

```bash
# AND - 所有必须匹配
"web AND database"

# OR - 任何可以匹配
"web OR api"

# NOT - 排除匹配
"web AND NOT experimental"
```

### 使用括号分组

```bash
# 分组 OR 运算
"(web OR api) AND database"

# 复杂分组
"(frontend AND web) OR (backend AND api)"

# 多级分组
"(web OR api) AND (prod OR staging) AND NOT deprecated"
```

## 策略映射

命令自动将过滤表达式映射到预设策略：

- **简单标签**（`"web"`）→ `tag` 策略
- **逗号分隔**（`"web,api"`）→ `OR` 策略
- **布尔表达式**（`"web AND api"`）→ `advanced` 策略

## 使用技巧

- **引用表达式**：始终用引号包装复杂的过滤表达式
- **先测试**：创建后使用 `preset test <name>` 验证服务器匹配
- **描述性名称**：为团队协作使用清晰、描述性的预设名称
- **从简单开始**：从简单的逗号分隔过滤器开始，然后转向复杂表达式

## 错误处理

常见错误和解决方案：

```bash
# 名称中的无效字符
Error: Preset name can only contain letters, numbers, hyphens, and underscores

# 无效的过滤语法
Error: Invalid filter expression: unexpected token 'XYZ'

# 空过滤器
Error: Filter expression cannot be empty
```

## 另请参阅

- **[智能交互模式](./)** - 基于 TUI 的交互式预设创建
- **[preset list](./list)** - 列出所有可用的预设
- **[preset show](./show)** - 显示详细的预设信息
- **[preset test](./test)** - 测试预设服务器匹配
- **[preset url](./url)** - 为客户端配置生成预设 URL
