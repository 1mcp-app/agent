---
title: Runtime Target Context 命令
description: 管理已验证的具名 1MCP 运行时目标及其本地元数据。
---

# Runtime Target Context 命令

Runtime Target Context 是已验证且具名的运行时端点。具名 context 可以携带本地保存的 bearer 凭据；临时 `--url` 连接不能。对于需要反复使用的远程工作流，请使用 context。

```bash
1mcp target <subcommand> [options]
```

## 添加和选择

```bash
1mcp target add <name> <url> [options]
1mcp target use <name> [options]
```

`target add` 会先验证 Runtime Identity 端点，再保存目标。

- `add`：`--use`、`--display-name <label>`、`--ca-file <path>`、`--insecure-skip-verify`、`--replace`、`--accept-new-identity`。
- `use`：`--accept-insecure-tls`、`--json`。

```bash
1mcp target add prod https://mcp.example.com/mcp --use
1mcp target add staging https://mcp.example.com/mcp --ca-file ./company-ca.pem
```

## 查看和验证

```bash
1mcp target current
1mcp target list
1mcp target inspect <name>
1mcp target verify <name> [--accept-insecure-tls] [--json]
```

`current` 和 `list` 不会访问运行时。`verify` 用于确认已保存目标的身份。

## 导入、导出和修复

```bash
1mcp target export [--output <file>]
1mcp target import <file> [--dry-run] [--json]
1mcp target doctor [--fix-secrets] [--prune-orphans]
```

导入文件使用 `-` 时从 stdin 读取 bundle。`doctor --fix-secrets` 修复本地密钥存储权限；`--prune-orphans` 删除缺失目标的凭据引用。

## 重命名和删除

```bash
1mcp target rename <old> <new>
1mcp target delete <name> [--force]
```

`delete --force` 同样允许删除当前 context。

## 使用 Context

`instructions`、`inspect`、`run` 和 `proxy` 都实现了 `--context <name>` 选择器：

```bash
1mcp instructions --context prod
1mcp inspect --context prod filesystem/read_file
1mcp run --context prod filesystem/read_file --args '{"path":"./README.md"}'
1mcp proxy --context prod
```

对于 bearer 身份验证，先将令牌保存到具名 context：

```bash
1mcp auth login --context prod --token "$TOKEN"
```

另请参阅 [auth](/zh/commands/auth) 和 [proxy](/zh/commands/proxy)。
