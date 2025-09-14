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
sudo mv 1mcp /usr/local/bin/
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
sudo mv 1mcp /usr/local/bin/
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
sudo mv 1mcp /usr/local/bin/
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
sudo mv 1mcp /usr/local/bin/
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
.\1mcp.exe --version

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
- ✅ **便携性**: 单文件随处可运行
- ✅ **安全性**: 由 GitHub Actions 预构建和签名
- ✅ **压缩归档**: tar.gz/zip 格式，下载速度提升 67%
- ✅ **多架构**: 支持所有平台的 x64 和 ARM64 架构
- ✅ **标准格式**: 无需特殊解压工具，适用于所有系统

## 包管理器

### npm/pnpm

```bash
# 全局安装
npm install -g @1mcp/agent
# 或
pnpm add -g @1mcp/agent

# 直接使用
npx @1mcp/agent --config mcp.json
```

### Docker

我们提供两种 Docker 镜像变体：

- **`latest`**: 包含额外工具 (uv, bun) 的全功能镜像
- **`lite`**: 仅包含基本 Node.js 包管理器的轻量级镜像

```bash
# 拉取并运行 (全功能镜像) - 重要：设置主机为 0.0.0.0 以支持 Docker 网络
docker run -p 3050:3050 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3050 \
  -e ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050 \
  -v $(pwd)/mcp.json:/app/mcp.json \
  ghcr.io/1mcp-app/agent:latest

# 拉取并运行 (轻量级镜像) 带正确的网络配置
docker run -p 3050:3050 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3050 \
  -e ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050 \
  -v $(pwd)/mcp.json:/app/mcp.json \
  ghcr.io/1mcp-app/agent:lite

# 中国用户 - 更快的包安装速度
docker run -p 3050:3050 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3050 \
  -e ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050 \
  -e npm_config_registry=https://registry.npmmirror.com \
  -e UV_INDEX=http://mirrors.aliyun.com/pypi/simple \
  -e UV_DEFAULT_INDEX=http://mirrors.aliyun.com/pypi/simple \
  -v $(pwd)/mcp.json:/app/mcp.json \
  ghcr.io/1mcp-app/agent:latest

# 使用 docker-compose (推荐)
cat > docker-compose.yml << 'EOF'
services:
  1mcp:
    image: ghcr.io/1mcp-app/agent:latest
    ports:
      - "3050:3050"
    volumes:
      - ./mcp.json:/app/mcp.json
    environment:
      - ONE_MCP_HOST=0.0.0.0
      - ONE_MCP_PORT=3050
      - ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050
      - ONE_MCP_LOG_LEVEL=info
      - ONE_MCP_CONFIG=/app/mcp.json
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

#### 可用标签

**全功能镜像:**

- `latest`, `vX.Y.Z`, `vX.Y`, `vX`, `sha-<commit>`

**轻量级镜像:**

- `lite`, `vX.Y.Z-lite`, `vX.Y-lite`, `vX-lite`, `sha-<commit>-lite`

## 从源码构建

### 先决条件

- Node.js (来自 `.node-version` 的版本 - 目前为 22)
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
- **运行时**：Node.js 21+

## 下一步

- [快速入门指南](/zh/guide/quick-start) - 5 分钟内运行
- [配置](/zh/guide/essentials/configuration) - 详细的设置选项
