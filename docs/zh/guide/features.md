---
title: 1MCP 功能概述 - 完整功能指南
description: 探索所有 1MCP 功能，包括核心能力、安全性、性能、企业功能、集成和开发工具。完整功能参考。
head:
  - ['meta', { name: 'keywords', content: '1MCP 功能,功能概述,安全性,性能,企业,集成' }]
  - ['meta', { property: 'og:title', content: '1MCP 功能概述 - 完整指南' }]
  - ['meta', { property: 'og:description', content: '探索所有 1MCP 功能。安全性、性能、企业能力和集成。' }]
---

# 1MCP 功能概述

> **🎯 理念**：每个功能的存在都是为了解决一个真实的用户问题。我们构建了您实际需要的功能，而不仅仅是听起来令人印象深刻的功能。

## 🚀 快速发现（选择您的路径）

- **👋 我是 1MCP 的新手** → [核心功能](/guide/essentials/core-features)
- **🔒 我需要安全** → [安全与访问控制](/guide/advanced/security)
- **⚡ 我想要性能** → [性能与可靠性](/guide/advanced/performance)
- **🏢 我运行生产系统** → [企业版与运维](/guide/advanced/enterprise)
- **🔧 我是开发人员** → [开发者与集成](/guide/integrations/developer-tools)
- **🔗 我想要整合应用** → [应用整合](/guide/integrations/app-consolidation)
- **🖥️ 我使用 Claude Desktop** → [Claude Desktop 集成](/guide/integrations/claude-desktop)
- **⚙️ 我需要服务器管理** → [服务器管理](/guide/essentials/server-management)
- **🏷️ 我想要服务器过滤** → [服务器过滤](/guide/advanced/server-filtering)
- **⚡ 我需要快速启动** → [快速启动](/guide/advanced/fast-startup)

---

## 🌟 [核心功能](/guide/essentials/core-features)

开箱即用的基础功能，适用于每个用户：

- **🔗 通用 MCP 聚合** - 通过一个端点连接所有 MCP 服务器
- **🔄 热配置重载** - 零停机时间内即时添加/移除服务器
- **📊 基本状态监控** - 跟踪连接和排除问题

适用场景：入门使用、基本代理需求、开发环境

---

## 🔒 [安全与访问控制](/guide/advanced/security)

具有细粒度权限的企业级安全：

- **🛡️ OAuth 2.1 身份验证** - 行业标准的安全令牌管理
- **🏷️ 基于标签的访问控制** - 使用服务器标签和范围的细粒度权限
- **🚫 速率限制和 DDoS 防护** - 每客户端可配置请求限制

适用场景：团队、共享环境、安全合规、生产系统

---

## ⚡ [性能与可靠性](/guide/advanced/performance)

为生产而构建，具备智能恢复功能：

- **🔄 高效请求处理** - 具有适当错误处理的直接转发
- **🔄 自动重试与恢复** - 失败连接的指数退避
- **📊 监控与日志** - 结构化日志和基本系统监控

适用场景：生产系统、不可靠网络、关键工作流

---

## 🏢 [企业版与运维](/guide/advanced/enterprise)

生产就绪的部署和运营功能：

- **🔧 单实例部署** - 简单、可靠的进程管理
- **⚡ 异步加载与实时更新** - 渐进式功能发现
- **💊 健康监控与可观测性** - 全面的健康端点
- **📋 安全操作日志** - 跟踪身份验证和访问事件
- **🔧 高级配置管理** - 环境特定配置和密钥

适用场景：生产部署、DevOps 自动化、企业环境

---

## 🔧 [开发者与集成](/guide/integrations/developer-tools)

开发者友好的 API 和集成工具：

- **🔌 RESTful API 与标准合规** - 完全兼容 MCP 的干净 REST API
- **📡 HTTP 传输与 MCP 协议** - 标准合规的通信
- **🧪 开发与集成支持** - 热重载、调试、MCP Inspector 支持

适用场景：自定义集成、API 客户端、开发工作流、测试

---

## 🔗 [应用整合](/guide/integrations/app-consolidation)

统一来自多个桌面应用程序的 MCP 服务器配置：

- **🎯 多应用集成** - 整合 Claude Desktop、Cursor、VS Code 等
- **🔄 安全配置管理** - 带有简单恢复的自动备份
- **⚡ 即时设置** - 一个命令整合任何支持的应用程序

适用场景：管理多个 MCP 启用的应用程序、跨工具共享服务器

---

## 🖥️ [Claude Desktop 集成](/guide/integrations/claude-desktop)

通过两种灵活方法与 Claude Desktop 无缝集成：

- **📍 本地配置整合** - 通过 stdio 自动配置 Claude Desktop（推荐）
- **🌐 远程自定义连接器** - 通过 HTTPS 连接到远程 1MCP 服务器
- **🔐 OAuth 2.1 支持** - 远程连接的安全身份验证

适用场景：Claude Desktop 用户、远程团队协作、安全的企业部署

---

## ⚙️ [服务器管理](/guide/essentials/server-management)

全面的 MCP 服务器生命周期和配置管理：

- **🔧 多种传输类型** - 支持 stdio、HTTP 和 SSE 传输
- **🏷️ 基于标签的组织** - 使用灵活的标签系统组织服务器
- **🔄 生命周期管理** - 添加、更新、启用、禁用和删除服务器
- **🛡️ 安全与环境** - 安全的环境变量和配置处理

适用场景：DevOps 团队、复杂服务器配置、生产部署

---

## 🏷️ [服务器过滤](/guide/advanced/server-filtering)

使用灵活的基于标签的过滤控制对特定 MCP 服务器的访问：

- **🎯 基于标签的访问控制** - 按分配的标签过滤服务器以获得细粒度访问
- **🔍 选择性服务器暴露** - 仅连接到与指定条件匹配的服务器
- **🚫 多条件过滤** - 组合多个标签以实现精确的服务器选择
- **🔧 运行时配置** - 无需服务器重启的动态过滤

适用场景：多租户环境、基于角色的访问、环境分离

---

## ⚡ [快速启动](/guide/advanced/fast-startup)

通过异步服务器加载让 1MCP 立即运行：

- **🚀 亚秒级启动** - 无论服务器数量如何，1MCP 在 1 秒内就绪
- **🔄 后台服务器加载** - 服务器异步连接，不阻塞启动
- **📊 实时状态更新** - 服务器可用时的实时通知
- **🛡️ 弹性操作** - 单个服务器故障不会破坏整个系统

适用场景：开发工作流、不可靠网络、大型服务器配置

---

## 🚀 按用户类型的功能矩阵

| 功能               | 最终用户          | 开发人员    | 管理员      | DevOps      | 企业          |
| ------------------ | ----------------- | ----------- | ----------- | ----------- | ------------- |
| **MCP 聚合**       | ✅ 必不可少       | ✅ 必不可少 | ✅ 必不可少 | ✅ 必不可少 | ✅ 必不可少   |
| **热重载**         | 🔄 自动           | 🔧 调试工具 | ⚡ 关键     | ⚡ 关键     | ⚡ 关键       |
| **异步加载**       | ⚡ 更快的用户体验 | 🔧 可选     | ⚡ 性能     | ⚡ 可伸缩性 | ⚡ 企业       |
| **健康监控**       | 👁️ 基本           | 🔧 调试数据 | 📊 API 访问 | 📊 日志记录 | 📊 自定义     |
| **OAuth 2.1**      | 🔒 透明           | 🔌 集成     | 🛡️ 必需     | 🛡️ 必需     | 🛡️ 自定义     |
| **基于标签的访问** | 🚫 隐藏           | 🔧 可配置   | ✅ 管理     | ✅ 策略     | ✅ 自定义     |
| **速率限制**       | 🚫 透明           | 🔧 可配置   | 🛡️ 保护     | 📊 监控     | 📊 自定义     |
| **请求处理**       | ⚡ 自动           | ⚡ 可靠     | ⚡ 稳定     | ⚡ 监控     | ⚡ 可伸缩     |
| **单实例**         | ✅ 简单           | ✅ 轻松部署 | ✅ 可管理   | ✅ 可靠     | 🔧 自定义设置 |
| **基本日志记录**   | 🚫 隐藏           | 🔍 调试     | 📋 监控     | 📋 分析     | 📋 自定义     |
| **HTTP 传输**      | ⚡ 自动           | 🔌 API 功能 | 📊 监控     | 📊 集成     | 📊 自定义     |
| **应用整合**       | ✅ 简单           | 🔧 集成     | ✅ 管理     | ✅ 自动化   | ✅ 企业       |
| **Claude Desktop** | ✅ 必不可少       | 🔧 集成     | 🔧 设置     | 📊 远程     | 🛡️ 安全       |
| **服务器管理**     | 🚫 隐藏           | ✅ 必不可少 | ✅ 关键     | ✅ 关键     | ✅ 高级       |
| **服务器过滤**     | 🚫 透明           | 🔧 可配置   | 🛡️ 访问控制 | 🛡️ 策略     | 🛡️ 多租户     |

**图例**：✅ 主要好处 | ⚡ 性能 | 🔒 安全 | 🔧 技术 | 🛡️ 保护 | 📊 监控 | 🚫 不相关

---

## 🎯 功能入门

### 快速入门路径

1. **[5 分钟]** 基本 MCP 聚合 → [快速开始](/guide/getting-started)
2. **[15 分钟]** 添加身份验证 → [安全功能](/guide/advanced/security)
3. **[30 分钟]** 生产功能 → [企业功能](/guide/advanced/enterprise)

### 特定功能指南

- **安全设置** → [身份验证指南](/guide/advanced/authentication)
- **配置** → [配置指南](/guide/essentials/configuration)
- **开发** → [开发者功能](/guide/integrations/developer-tools)
- **应用集成** → [应用整合指南](/guide/integrations/app-consolidation)
- **Claude Desktop** → [Claude Desktop 集成](/guide/integrations/claude-desktop)
- **服务器管理** → [服务器管理指南](/guide/essentials/server-management)
- **服务器过滤** → [服务器过滤指南](/guide/advanced/server-filtering)
- **性能** → [快速启动指南](/guide/advanced/fast-startup)
- **架构** → [系统架构](/reference/architecture)

---

> **💡 专业提示**：从[核心功能](/guide/essentials/core-features)开始，然后随着需求增长添加高级功能。每个功能都设计为独立工作，可以增量启用。
