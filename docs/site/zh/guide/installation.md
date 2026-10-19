---
title: 安装指南 - 二进制、NPM、Docker
description: 在 Linux、macOS 或 Windows 上安装 1MCP Agent。选择独立二进制、NPM 包或 Docker 容器。完整安装说明。
head:
  - ['meta', { name: 'keywords', content: '1MCP 安装,二进制下载,NPM 安装,Docker 设置' }]
  - ['meta', { property: 'og:title', content: '1MCP 安装指南 - 所有平台' }]
  - ['meta', { property: 'og:description', content: '在任何平台上安装 1MCP。提供独立二进制、NPM 或 Docker 选项。' }]
---

# 安装

## 二进制下载 (推荐)

下载适合您平台的独立二进制文件 - 无需安装 Node.js！

### 支持的平台

- **Linux (x64)**: `1mcp-linux-x64`
- **Linux (ARM64)**: `1mcp-linux-arm64`
- **Windows (x64)**: `1mcp-win32-x64.exe`
- **macOS (ARM64)**: `1mcp-darwin-arm64`
- **macOS (Intel)**: `1mcp-darwin-x64`

### 快速安装

**Linux (x64):**

```bash
# 下载并解压归档文件
curl -L -o 1mcp-linux-x64.tar.gz https://github.com/1mcp-app/agent/releases/latest/download/1mcp-linux-x64.tar.gz
tar -xzf 1mcp-linux-x64.tar.gz
sudo mv 1mcp-linux-x64 /usr/local/bin/1mcp
sudo chmod +x /usr/local/bin/1mcp

# 清理文件
rm 1mcp-linux-x64.tar.gz

# 验证安装
1mcp --version
```

**Linux (ARM64 - 树莓派、AWS Graviton):**

```bash
# 下载并解压归档文件
curl -L -o 1mcp-linux-arm64.tar.gz https://github.com/1mcp-app/agent/releases/latest/download/1mcp-linux-arm64.tar.gz
tar -xzf 1mcp-linux-arm64.tar.gz
sudo mv 1mcp-linux-arm64 /usr/local/bin/1mcp
sudo chmod +x /usr/local/bin/1mcp

# 清理文件
rm 1mcp-linux-arm64.tar.gz

# 验证安装
1mcp --version
```

**macOS (Apple Silicon - M1/M2/M3):**

```bash
# 下载并解压归档文件
curl -L -o 1mcp-darwin-arm64.tar.gz https://github.com/1mcp-app/agent/releases/latest/download/1mcp-darwin-arm64.tar.gz
tar -xzf 1mcp-darwin-arm64.tar.gz
sudo mv 1mcp-darwin-arm64 /usr/local/bin/1mcp
sudo chmod +x /usr/local/bin/1mcp

# 清理文件
rm 1mcp-darwin-arm64.tar.gz

# 验证安装
1mcp --version
```

**macOS (Intel):**

```bash
# 下载并解压归档文件
curl -L -o 1mcp-darwin-x64.tar.gz https://github.com/1mcp-app/agent/releases/latest/download/1mcp-darwin-x64.tar.gz
tar -xzf 1mcp-darwin-x64.tar.gz
sudo mv 1mcp-darwin-x64 /usr/local/bin/1mcp
sudo chmod +x /usr/local/bin/1mcp

# 清理文件
rm 1mcp-darwin-x64.tar.gz

# 验证安装
1mcp --version
```

**Windows (x64 - PowerShell):**

```powershell
# 下载并解压归档文件
Invoke-WebRequest -Uri "https://github.com/1mcp-app/agent/releases/latest/download/1mcp-win32-x64.zip" -OutFile "1mcp-win32-x64.zip"
Expand-Archive -Path "1mcp-win32-x64.zip" -DestinationPath "."

# 选项 1：直接使用
.\1mcp-win32-x64.exe --version

# 选项 2：添加到 PATH 以获得全局访问权限
# 移动到 PATH 中的目录（如 C:\Windows\System32 或创建新目录）
# 然后您可以使用：1mcp --version

# 清理文件
Remove-Item "1mcp-win32-x64.zip"
```

**手动下载:**

访问[最新发布页面](https://github.com/1mcp-app/agent/releases/latest)并下载适合您平台的二进制文件。

### 优势

- ✅ **无依赖**: 无需安装 Node.js
- ✅ **快速启动**: 即时执行，无包解析过程
- ✅ **便携性**: 平台专用的单一可执行文件，无需安装 Node.js
- ✅ **发布构建**: 平台归档由发布工作流构建
- ✅ **压缩归档**: tar.gz/zip 格式，下载速度提升 67%
- ✅ **平台覆盖**: Linux 和 macOS 支持 x64 与 ARM64；Windows 发布版支持 x64
- ✅ **标准格式**: 无需特殊解压工具，适用于所有系统

## 包管理器

### npm/pnpm

npm 安装路径需要 Node.js `^20.19.0 || ^22.12.0 || >=23.0.0`。

```bash
# 全局安装
npm install -g @1mcp/agent
# 或
pnpm add -g @1mcp/agent

# 直接使用
npx @1mcp/agent --config mcp.json
```

### Docker

您也可以使用 Docker 运行 1MCP。我们提供两种镜像变体：

- **`latest`**: 包含额外工具 (uv, bun) 的全功能镜像 - 默认
- **`lite`**: 仅包含基本 Node.js 包管理器 (npm, pnpm, yarn) 的轻量级镜像

请将 `mcp.json` 和可选的同级 `config.toml` 放在专用目录中。该目录以可写方式挂载，使 `mcp add` 和 `mcp update` 能够持久化更改。

```bash
# 准备容器配置目录
mkdir -p 1mcp-config
cp mcp.json 1mcp-config/
# 如果使用 auth 等应用设置：cp config.toml 1mcp-config/

# 拉取并运行 (全功能镜像)；仅发布到宿主机回环接口
docker run -p 127.0.0.1:3050:3050 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3050 \
  -e ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050 \
  -e ONE_MCP_CONFIG=/usr/src/app/config/mcp.json \
  -v "$(pwd)/1mcp-config:/usr/src/app/config" \
  ghcr.io/1mcp-app/agent:latest

# 拉取并运行 (轻量级镜像) 带正确的网络配置
docker run -p 127.0.0.1:3050:3050 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3050 \
  -e ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050 \
  -e ONE_MCP_CONFIG=/usr/src/app/config/mcp.json \
  -v "$(pwd)/1mcp-config:/usr/src/app/config" \
  ghcr.io/1mcp-app/agent:lite

# 中国用户 - 更快的包安装速度
docker run -p 127.0.0.1:3050:3050 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3050 \
  -e ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050 \
  -e npm_config_registry=https://registry.npmmirror.com \
  -e UV_INDEX=http://mirrors.aliyun.com/pypi/simple \
  -e UV_DEFAULT_INDEX=http://mirrors.aliyun.com/pypi/simple \
  -e ONE_MCP_CONFIG=/usr/src/app/config/mcp.json \
  -v "$(pwd)/1mcp-config:/usr/src/app/config" \
  ghcr.io/1mcp-app/agent:latest

# 使用 docker-compose (推荐)
cat > docker-compose.yml << 'EOF'
services:
  1mcp:
    image: ghcr.io/1mcp-app/agent:latest
    ports:
      - "127.0.0.1:3050:3050"
    volumes:
      - ./1mcp-config:/usr/src/app/config
    environment:
      - ONE_MCP_HOST=0.0.0.0
      - ONE_MCP_PORT=3050
      - ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050
      - ONE_MCP_LOG_LEVEL=info
      - ONE_MCP_CONFIG=/usr/src/app/config/mcp.json
      # 可选：中国大陆用户加速
      # - npm_config_registry=https://registry.npmmirror.com
      # - UV_INDEX=http://mirrors.aliyun.com/pypi/simple
      # - UV_DEFAULT_INDEX=http://mirrors.aliyun.com/pypi/simple
      # 可选：企业代理环境
      # - https_proxy=${https_proxy}
      # - http_proxy=${http_proxy}
EOF

docker compose up -d
```

这些示例只能从 Docker 宿主机访问。将 1MCP 发布到其他接口前，请在 `1mcp-config/config.toml` 中启用身份验证，将 `ONE_MCP_EXTERNAL_URL` 设置为公共 HTTPS URL，并遵循[身份验证指南](/zh/guide/advanced/authentication)。在未启用身份验证时绑定到回环接口以外的地址，会把 MCP 能力暴露给网络。

#### 可用标签

**全功能镜像:**

- `latest`, `vX.Y.Z`, `vX.Y`, `vX`

**轻量级镜像:**

- `lite`, `vX.Y.Z-lite`, `vX.Y-lite`, `vX-lite`

### 镜像详情

**全功能镜像 (`latest`):**

- Node.js (来自 `.node-version` 的版本)
- npm, pnpm, yarn
- uv (Python 包管理器)
- bun (JavaScript 运行时)
- curl, python3, bash

**轻量级镜像 (`lite`):**

- Node.js (来自 `.node-version` 的版本)
- 仅 npm, pnpm, yarn
- 更小的体积，更快的下载

## 从源码构建

### 先决条件

- 使用 `.node-version` 记录的 Node.js 版本
- 仓库版本是受支持的源码构建环境，而不是已发布的包支持契约。
- pnpm 包管理器

### 构建步骤

```bash
# 克隆仓库
git clone https://github.com/1mcp-app/agent.git
cd agent

# 安装依赖
pnpm install

# 构建
pnpm build

# 运行
node build/index.js --config mcp.json
```

## 验证

验证安装：

```bash
# 二进制安装:
1mcp --version

# NPM 安装:
npx @1mcp/agent --version
```

## 系统要求

**二进制安装:**

- **内存**：最低 256MB RAM，推荐 1GB
- **磁盘**：最小空间（单一二进制文件 + 配置文件）
- **网络**：MCP 服务器的 HTTP/HTTPS 出站访问
- **操作系统**：Linux (x64/ARM64)、Windows (x64)、macOS (ARM64/x64)

**NPM 安装:**

- **内存**：最低 512MB RAM，推荐 2GB
- **磁盘**：用于 Node.js 依赖和日志的空间
- **网络**：MCP 服务器的 HTTP/HTTPS 出站访问
- **操作系统**：Linux (x64/ARM64)、macOS (ARM64/x64)、Windows (x64)
- **运行时**：npm 安装使用 Node.js `^20.19.0 || ^22.12.0 || >=23.0.0`；源码构建使用 `.node-version`

## 下一步

- [快速入门指南](/zh/guide/quick-start) - 5 分钟内运行
- [配置](/zh/guide/essentials/configuration) - 详细的设置选项
