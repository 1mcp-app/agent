---
title: 原生图索引准备验收
description: 复现原生图索引所有权和新鲜度诊断，明确自动准备的未完成验收。
---

# 原生图索引准备验收

本页用于复现 CodeGraph 和 Code Review Graph 的原生安全性调查。诊断脚本**不是准备集成**，不会启用安装目录项、确认就绪状态或安装依赖。现有配置命令的生命周期见[后端准备](/zh/guide/backend-preparation)。

## 复现调查

在已安装两个后端的源码工作目录中运行：

```bash
python3 -B scripts/verify-native-preparation-graphs.py \
  /absolute/path/to/codegraph-platform-bundle \
  /absolute/path/to/crg-virtualenv/bin/python
```

CodeGraph 平台安装目录应包含 `node`、`package.json` 和 `lib/dist`。CRG 参数应保留虚拟环境解释器的路径，解析解释器符号链接可能丢失该环境的包。脚本直接使用指定安装，不调用 `npx`、`uvx` 或依赖安装器。

脚本只在 `/private/tmp/1mcp-651` 下新建主仓库、关联 worktree 和独立仓库，原生命令只索引这些临时仓库。脚本只读检查已安装源码，不打开或同步实际工作仓库的索引；禁用测试仓库 Git hooks、CodeGraph 下载、遥测和守护进程。保留的 `graphs-native-*/evidence.json` 包含实际命令、结果、源码路径、哈希、行摘录、耗时和仓库身份。最后一次完整结果位于 `/private/tmp/1mcp-651/graphs-native-evidence.json`。

退出码 0 只表示诊断复现了指定原生行为，**不表示自动准备通过验收**。后端实现变化可能导致断言失败，应先检查实际结果。

## 已验证范围

2026-10-14 调查使用 macOS arm64 上已安装的 CodeGraph **1.6.2** 和 Code Review Graph **2.3.9**。主仓库、关联 worktree、独立仓库的原生查询均返回本目录独有 Python 符号，并排除其他目录的符号。每个初始仓库只有一个受支持 Python 文件，约 39–53 字节。这只证明这些样本的目录隔离，不代表通用语言或平台支持。

一次记录的耗时：

| 操作                        | 主仓库 | 关联 worktree | 独立仓库 |
| --------------------------- | -----: | ------------: | -------: |
| CodeGraph 原生初始化        | 488 ms |        528 ms |   516 ms |
| CRG 原生构建                | 269 ms |        269 ms |   228 ms |
| CodeGraph 原生只读状态/查询 | 148 ms |        144 ms |   140 ms |
| CRG 原生状态                | 202 ms |        204 ms |   207 ms |
| CodeGraph 原生源码扫描      | 213 ms |        216 ms |   235 ms |

这些小样本无法证明大仓库性能、无关工具响应速度、生产调度或运行时准备任务取消。

## 原生所有权阻塞项

**CodeGraph CLI 初始化先写后锁。** 独立存活进程通过后端实际导出的 `FileLock` 获得锁后，原生 `init --yes` 仍创建了 `codegraph.db`，报告索引锁获取失败，并以 **0** 退出。外部进程及锁保持完整。不能仅依据退出码确认初始化成功。

**CodeGraph CLI 同步可能在锁失败之前干扰外部写入。** 外部原生写进程持有 `FileLock`，并通过 `DatabaseConnection.beginBulkNodeLoad()` 暂时移除了 FTS trigger。原生 `sync` 打开数据库后修复该窗口、重新创建 `nodes_ai`，随后才因获取锁失败以 **1** 退出。外部进程和 PID 锁仍保持完整。这是实际原生写入协调证据，不是集成专用模拟锁。

**CodeGraph 原生 API 没有向索引入口传递已获得锁的接口。** 在 `CodeGraph.open()` 前获得 `FileLock` 可以保护该调用的打开操作，但 `sync()` 和 `indexAll()` 会再次获取锁，连相同 PID 也被拒绝。前者抛错，后者返回 `success: false`。现有入口没有注入已获得锁或在其保护下索引的选项；修改私有锁方法不是受支持方案。额外包装锁也无法阻止原生初始化已观察到的锁前写入。

**CRG 原生操作不会保留外层 SQLite 所有权事务。** `GraphStore` 构造时打开可写状态并执行 schema 初始化/迁移，没有只读参数或已有连接参数。`set_metadata()` 会提交连接，`store_file_nodes_edges()` 会回滚已有事务，再开始和提交自己的事务。实验确认元数据操作释放外层事务，原生文件写入回滚未提交标记，之后第二个 SQLite 写连接可以获得锁。实验仅用连接测试该假设，不提供生产私有 API，也未替换原生方法。

SQLite 可以保护 CRG 的单个事务；此结果不表示 SQLite 没有锁，而是证明无法简单用一个外层事务覆盖整个原生构建/更新。额外 SQLite 连接持锁会阻塞原生连接自己的写入；集成专用锁也不能协调原生 watcher 和 CLI。

诊断只向自己启动的持锁进程发送 `SIGTERM`，由持锁进程释放自己的原生锁，不修复或删除外部锁。这验证的是诊断进程清理，**不是**运行时准备取消验收。

## 新鲜度与只读边界

初始化后加入旧示例 manifest 之外的未提交 Python 文件时，CodeGraph 仍报告 `index_state: complete`、`isIndexStale(): false`，但查询缺少新符号。该方法检查的是提取版本兼容性，不是源码新鲜度。CRG 的已存储/当前 Git commit 相同，`build_incomplete: false`，查询仍缺少新符号。两者的廉价状态查询均不能证明源码已同步。

CodeGraph 的只读实例调用原生 `getChangedFiles()` 可以发现新增文件，因此完整受支持源码扫描是可能的新鲜度入口；必须评估其必要性和规模成本。样本中的原生只读打开操作还改变了 SQLite WAL/SHM 侧文件，诊断记录具体文件名。CRG 状态查询在本次已完成状态下没有改变索引字节，但其他状态的 `GraphStore` 构造仍可能执行可写迁移。这些结果均不证明通用的严格只读暖探测。

记录的源码证据包含文件 SHA-256 和行摘录：

| 后端      | 源码                               | 本次安装的相关行                                                                     |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| CodeGraph | `lib/dist/index.js`                | 282–300 初始化；446–453 索引锁；762–769 同步锁；1270–1275 提取版本新鲜度             |
| CodeGraph | `lib/dist/utils.js`                | 269–335 原生锁获取及所有者释放                                                       |
| CodeGraph | `lib/dist/db/index.js`             | 187–218 可写打开、迁移、bulk-load 修复                                               |
| CodeGraph | `lib/dist/bin/codegraph.js`        | 633–705 初始化；927–945 同步前打开                                                   |
| CRG       | `code_review_graph/graph.py`       | 701–722 构造；978–1013 事务替换和文件提交；1102–1110 元数据提交；1143–1148 提交/回滚 |
| CRG       | `code_review_graph/incremental.py` | 1744–1781 构建 API；1833–1846、2136–2146 新鲜度写入和提交                            |

## 未完成验收

本调查没有确认两个后端的自动准备支持。所有原生写入前的安全准入、完整操作期间的原生写入协调、严格只读暖探测、准备任务取消隔离、完整受支持源码新鲜度仍未通过验收。不提供仅安装的目录项或永远返回不支持的 helper 作为替代。

后续可行方案需要 CodeGraph 在数据库初始化、打开、修复前获得原生锁，并提供已获得所有权的 API。CRG 需要覆盖构造/schema、文件批次、元数据和后处理的原生操作所有权，不替换外层所有者事务，并提供真正只读检查入口。这需要后端改动或另行验证的原生接口；本诊断不修改已安装后端，也不宣布功能完成。
