---
title: 后端配置与准备验证
description: 面向贡献者的后端集成复现步骤、配置证据及准备验收门槛。
---

# 后端配置与准备验证

本页供开发或审查后端集成的贡献者使用。最终用户请先阅读[后端准备](/zh/guide/backend-preparation)和 [mcp setup](/zh/commands/mcp/setup)。

以下为 `mcp setup` 命令拆分前 PR 版本保留的历史结果，尚未针对当前版本重新运行。下方复现命令用于开展新的验证。

## 已验证的示例范围

2026-10-16，下列已安装后端在 macOS 26.6.2 arm64、Node.js 26.4.0 上通过配置及原生源码验收。这些是已测组合，不保证其他版本、平台、语言或仓库规模。

| 示例              | 已测版本            | 代表性公共操作                                                       | 结果               |
| ----------------- | ------------------- | -------------------------------------------------------------------- | ------------------ |
| CodeGraph         | 1.6.2               | `codegraph_explore` 返回选定副本的源码                               | 模板及静态目标通过 |
| Code Review Graph | 2.3.9               | `get_minimal_context_tool`，再调用带源码的 `get_review_context_tool` | 模板及静态目标通过 |
| Serena            | 2.0.0，独立工具接口 | 原生说明/onboarding 指引，再调用包含函数体的 `find_symbol`           | 模板及静态目标通过 |

每个后端均从主副本、关联工作树和独立仓库返回各自独有的源码。同一份可复用模板配置服务三个副本，并在访问其他副本后再次查询主副本。夹具路径包含空格、与号及单引号。dry-run、等价重复配置（包括 `--force`）以及无关配置/密钥引用保留均通过。12 次隔离运行时生命周期中的 21 次原生源码查询全部通过。

每个副本只有一个 TypeScript 源文件。Serena 使用预装的 TypeScript 5.9.3 和 typescript-language-server 5.1.3，复制到隔离 home，无下载。原生初始化属于显式夹具准备：CodeGraph `init`、CRG `build` 和 Serena `project create`。保留原生 onboarding 指引，1MCP 不完成或伪造 onboarding。不宣称自动准备的新鲜度、原生写入者协调、取消或大仓库性能支持。

在已构建的源码副本中，预先安装指定依赖后复现：

```bash
python3 -B scripts/verify-known-server-setup.py \
  --cli "$PWD/build/index.js" \
  --codegraph /absolute/bin/codegraph \
  --crg /absolute/bin/code-review-graph \
  --serena /absolute/bin/serena \
  --serena-resources /absolute/serena-home
```

验证脚本把命令、结果和 `evidence.json` 写入新的系统临时目录。它通过公共 1MCP 检查/调用接口及生成的配置验证，不手工替换模板或访问原生私有接口。清理验证范围是前台进程组及已观察到的后代。两次观察之间快速后台化/重新托管的任意进程不在脚本契约内；它不是通用进程约束或运行时准备取消测试。

## 真实集成验收

CodeGraph 与 Code Review Graph 通过外部包装脚本使用相同配置命令契约。仓库 `examples/backend-preparation/README.md` 提供有界原生验收包装器，`scripts/verify-configured-preparation.mjs` 用于重复运行验收。Code Review Graph 的 status 本身不证明未提交源码新鲜度，包装脚本需要单独核验或明确报告缺口。运行时核心不解析后端专属就绪字段。验收证据需记录后端版本、平台、副本源码规模、冷准备时间、热探测开销、共享任务数、其他已就绪工具延迟、取消覆盖和可取得的 CPU/内存观察。通过本地测试不代表部署或客户端已激活。

## 原生诊断

- [图后端诊断](/zh/development/preparation-native-acceptance)
- [Serena 诊断](/zh/development/preparation-serena-acceptance)
