---
title: 管理后端服务器
description: 选择配置方式、验证就绪状态并维护后端配置。
---

# 管理后端服务器

根据后端情况选择配置方式，然后分别检查已保存的配置和运行时状态。

## 选择配置方式

| 起点                                               | 命令或指南                                           |
| -------------------------------------------------- | ---------------------------------------------------- |
| 已安装 CodeGraph、Code Review Graph 或 Serena 后端 | [mcp setup](/zh/commands/mcp/setup)                  |
| 注册表中的服务器                                   | [mcp install](/zh/commands/mcp/install)              |
| 已知可执行文件或远程 MCP URL                       | [mcp add](/zh/commands/mcp/add)                      |
| 已有桌面应用配置                                   | [应用整合](/zh/guide/integrations/app-consolidation) |

### 注册表配置

```bash
1mcp registry search filesystem --type=npm --transport=stdio
1mcp mcp install --interactive
```

选择实际的注册表结果。采用非交互方式时，先用 `1mcp mcp install <registry-id> --dry-run` 预览，再应用。注册表配置操作会写入后端定义，但不会验证软件包是否可信，也不能确认所需凭据和运行时依赖是否可用。版本选择限制见 [mcp install](/zh/commands/mcp/install)。

### 明确的启动命令或 URL

```bash
1mcp mcp add custom-server --type=stdio -- node /absolute/path/server.js
1mcp mcp add remote-api --type=http --url=https://mcp.example.com/mcp
```

将示例脚本或 URL 替换为实际后端。STDIO 启动子进程；HTTP 连接独立托管的服务。也支持旧版 SSE，但新集成在可用时应选择 Streamable HTTP。

将可执行文件与参数分开。后端需要时设置工作目录，并仅提供必要的环境变量。参阅 [MCP 服务器配置](/zh/reference/mcp-servers)。

## 在 Admin Console 中配置自定义服务器

需要添加静态服务器或模板服务器（Template Server）定义，但不希望手动编辑运行时配置文件时，请打开“服务器清单（Server inventory）→ 配置自定义服务器（Configure Custom Server）”。共享表单支持本地 STDIO、远程 HTTP 和旧版 SSE 目标。

1. 选择“静态（Static）”或“模板（Template）”，然后填写对应传输类型的结构化字段。STDIO 必须提供命令；HTTP 和 SSE 必须提供 URL。
2. 添加标签。静态目标可以选择初始启用状态；模板定义提供实例生命周期控件，并允许在运行时实际渲染的字段中使用 Handlebars 表达式。
3. 凭据优先使用“环境变量密钥引用（Environment Secret Reference）”。配置中只保存环境变量名或替换表达式，不保存密钥内容。内联密钥仅作为高级备用方式。
4. 选择“预览服务器（Preview server）”。预览会验证目标、报告名称冲突并隐藏密钥内容。静态远程目标会在适用时执行有界连接检查；模板预览只验证结构与请求上下文变量名称，不会渲染上下文、连接后端或创建实例。
5. 检查差异与运行时信息，然后明确确认与来源匹配的创建操作。

创建流程绝不会替换已有的静态目标或模板服务器目标。如果预览后有其他写入者占用了同一名称，确认操作会被拒绝，必须重新预览。写入成功后，Admin Console 会刷新服务器清单并打开标明来源的目标。模板定义会在重载后进入可用索引，只有后续匹配请求提供请求上下文时才会创建实例。

## 验证就绪状态

```bash
1mcp mcp list
1mcp mcp status custom-server
1mcp inspect
```

`mcp list` 确认已保存的定义。检查修改操作的重载结果，并对目标运行时使用 `inspect` 查看可见服务器状态和能力。配置成功不代表后端连接、认证或工具调用成功。运行时尚未启动时使用 [serve](/zh/commands/serve)。

项目感知后端应先遵循[项目检出目录指南](/zh/guide/project-checkouts)；仅完成配置不代表项目上下文或准备状态已就绪。

## 维护配置

```bash
1mcp mcp update custom-server --tags=custom,development
1mcp mcp disable custom-server
1mcp mcp enable custom-server
1mcp mcp uninstall custom-server
```

只执行您需要的操作。`update` 修改配置，`disable` 保留定义，`uninstall` 移除定义并默认创建备份。`uninstall` 不请求交互确认。请检查报告的备份路径和重载状态。这些命令都不是包管理器升级操作。

## 运维实践

使用清晰的名称和一致的标签，限制后端权限，并通过受支持的环境变量引用管理凭据。按后端设置连接与请求超时。调查重复故障前，参阅[恢复指南](/zh/guide/advanced/performance)和[后端日志](/zh/guide/advanced/backend-logs)。
