---
title: Serena 原生准备验收
description: 复现 issue 651 中已验证的 Serena 行为和未完成的准备验收门槛。
---

# Serena 原生准备验收

本页用于复现 issue #651 的原生证据，**不代表 Serena 生产准备能力已通过验收**。此诊断改动不交付生产 helper，也不增加仅支持配置的目录条目。

## 复现

使用实际 Serena 安装中的 Python 解释器。脚本要求已安装 `serena-agent 2.0.0`、TypeScript `5.9.3` 和 `typescript-language-server 5.1.3`，会在创建夹具前检查依赖，不执行安装。

```sh
mkdir -p /tmp/serena-acceptance
<SERENA_PYTHON> scripts/verify-native-preparation-serena.py \
  --fixture-root /tmp/serena-acceptance \
  --serena-home <ACTUAL_SERENA_HOME>
```

脚本创建独立运行目录，输出 JSON，并保留 `evidence.json` 和夹具。退出码零表示诊断断言复现成功，包括预期的更新丢失，不表示准备能力验收通过。保留输出供审查，完成后只删除该运行目录。

所有项目写入均位于新夹具中；原生语言服务依赖只从指定 Serena home 读取。脚本不读取或改写在线全局配置，不伪造 onboarding，不执行项目激活命令，也不调用运行时准备调度器。夹具 Git 提交关闭 hooks 和签名。

## 已观察结果

一次 macOS 运行使用 Serena `2.0.0`、Python `3.14.0`、Node.js `26.4.0`、TypeScript `5.9.3` 和语言服务 `5.1.3`。

| 原生查询目标 | 修改后源码字节数 |    冷查询 |    热查询 | 正常停止原生服务 |
| ------------ | ---------------: | --------: | --------: | ---------------: |
| 主检出       |               35 | 1.0137 秒 | 0.0001 秒 |        0.0053 秒 |
| 链接工作树   |               37 | 0.9172 秒 | 0.0004 秒 |        0.0058 秒 |
| 独立仓库     |               42 | 0.9611 秒 | 0.0001 秒 |        0.0049 秒 |

三个原生 SolidLSP 会话并发运行，返回各检出独有的类符号，并识别后续未提交的源码变化；没有保存符号缓存文件。热查询复用同一个原生会话，不是重新启动 helper 的耗时。正常停止不等于运行时任务取消验收。这些小夹具不能证明大仓库性能或其他已就绪工具的响应能力。

两个独立原生 Python 写进程在保存前加载同一份配置。A 保存 `read_only: true` 后，B 保存修改了初始提示词的旧快照，将 A 的 `read_only` 恢复为 false。A 完成时 B 仍然存活。该测试复现原生旧快照造成的更新丢失，不依赖 helper 自建锁。

## 安装源码证据与限制

以下路径相对于 `evidence.json` 记录的安装包根目录，JSON 同时保存源码 SHA-256。这些证据只对应已检查的 `2.0.0` 源码。

- `serena/config/serena_config.py:697–747`：`ProjectConfig.load` 即使禁用自动生成，也会补默认值并保存不完整配置；夹具复现该写入。
- `serena/config/serena_config.py:360, 424–480, 751–782`：项目生成和保存使用进程内线程锁。`serena/util/yaml.py:221–243` 的原子替换不能合并原生旧快照中的设置。
- `serena/config/serena_config.py:1054–1193`：全局加载器可能生成配置、修改权限、加载或迁移已注册项目并保存迁移结果，不是通用只读设置加载器。`1391` 的 `FileLock` 保护全局注册持久化，不保护项目配置或符号缓存。
- `serena/project.py:35–82`：原生 `Project` 构造会创建数据目录、空记忆目录和 `.gitignore`，不能证明语言后端已初始化或 onboarding 已完成。
- `serena/cli.py:1028–1065` 与 `serena/agent.py:1481–1520`：原生健康检查创建文件，agent 激活可能执行项目命令；诊断不将它们用作只读探测。
- `solidlsp/language_servers/typescript_language_server.py:266–319`：启动可能安装缺失依赖；诊断预先检查已有可执行文件及包版本。
- `solidlsp/ls.py:3088–3129`、`solidlsp/util/cache.py:28–30`：原生缓存保存没有项目级跨进程锁；诊断不保存缓存。
- `solidlsp/ls_config.py:1173`、`solidlsp/ls_process.py:527–533`：原生语言服务默认使用独立进程会话；诊断明确关闭该选项并只停止自己的服务，运行时超时与取消隔离仍需另行验证。

固定版本原生 API 支持 `ProjectConfig.autogenerate(save_to_disk=False)`。脚本验证：使用默认内存设置、显式 TypeScript 生成配置时不写文件；直接原生查询也不依赖持久化预热。这些只是可用的构件，不是完整准备能力的证明。仅创建新文件的排他发布仍是候选方案，但原生并发竞争行为及实际配置设置保留尚未验证；这些诊断也不能证明所有替代实现都需要修改上游。

仍需验证：实际配置目标的项目与语言后端只读就绪；全局及本地原生设置保留；与原生写进程共存的安全初始化和发布；任何缓存写入的原生协调；运行时取消和超时保留其他进程；有界热探测与响应能力；支持语言、版本和平台矩阵。在这些门槛通过前，Serena 与完整 #651 保持未完成。参见[后端准备](/zh/guide/backend-preparation)。
