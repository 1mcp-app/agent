# Installation

## Binary Downloads (Recommended)

Download the standalone binary for your platform - no Node.js required!

### Supported Platforms

- **Linux (x64)**: `1mcp-linux-x64`
- **Linux (ARM64)**: `1mcp-linux-arm64`
- **Windows (x64)**: `1mcp-win32-x64.exe`
- **macOS (ARM64)**: `1mcp-darwin-arm64`
- **macOS (Intel)**: `1mcp-darwin-x64`

### Quick Installation

**Linux (x64):**

```bash
# Download and extract archive
curl -L -o 1mcp-linux-x64.tar.gz https://github.com/1mcp-app/agent/releases/latest/download/1mcp-linux-x64.tar.gz
tar -xzf 1mcp-linux-x64.tar.gz
sudo mv 1mcp /usr/local/bin/
sudo chmod +x /usr/local/bin/1mcp

# Clean up
rm 1mcp-linux-x64.tar.gz

# Verify installation
1mcp --version
```

**Linux (ARM64 - Raspberry Pi, AWS Graviton):**

```bash
# Download and extract archive
curl -L -o 1mcp-linux-arm64.tar.gz https://github.com/1mcp-app/agent/releases/latest/download/1mcp-linux-arm64.tar.gz
tar -xzf 1mcp-linux-arm64.tar.gz
sudo mv 1mcp /usr/local/bin/
sudo chmod +x /usr/local/bin/1mcp

# Clean up
rm 1mcp-linux-arm64.tar.gz

# Verify installation
1mcp --version
```

**macOS (Apple Silicon - M1/M2/M3):**

```bash
# Download and extract archive
curl -L -o 1mcp-darwin-arm64.tar.gz https://github.com/1mcp-app/agent/releases/latest/download/1mcp-darwin-arm64.tar.gz
tar -xzf 1mcp-darwin-arm64.tar.gz
sudo mv 1mcp /usr/local/bin/
sudo chmod +x /usr/local/bin/1mcp

# Clean up
rm 1mcp-darwin-arm64.tar.gz

# Verify installation
1mcp --version
```

**macOS (Intel):**

```bash
# Download and extract archive
curl -L -o 1mcp-darwin-x64.tar.gz https://github.com/1mcp-app/agent/releases/latest/download/1mcp-darwin-x64.tar.gz
tar -xzf 1mcp-darwin-x64.tar.gz
sudo mv 1mcp /usr/local/bin/
sudo chmod +x /usr/local/bin/1mcp

# Clean up
rm 1mcp-darwin-x64.tar.gz

# Verify installation
1mcp --version
```

**Windows (x64 - PowerShell):**

```powershell
# Download and extract archive
Invoke-WebRequest -Uri "https://github.com/1mcp-app/agent/releases/latest/download/1mcp-win32-x64.zip" -OutFile "1mcp-win32-x64.zip"
Expand-Archive -Path "1mcp-win32-x64.zip" -DestinationPath "."

# Option 1: Use directly
.\1mcp.exe --version

# Option 2: Add to PATH for global access
# Move to a directory in PATH (e.g., C:\Windows\System32 or create a new directory)
# Then you can use: 1mcp --version

# Clean up
Remove-Item "1mcp-win32-x64.zip"
```

**Manual Download:**

Visit the [latest release page](https://github.com/1mcp-app/agent/releases/latest) and download the appropriate binary for your platform.

### Benefits

- ✅ **No Dependencies**: No Node.js installation required
- ✅ **Fast Startup**: Instant execution, no package resolution
- ✅ **Portable**: Single file that works anywhere
- ✅ **Secure**: Pre-built and signed by GitHub Actions
- ✅ **Compressed Archives**: tar.gz/zip format for faster downloads (~67% smaller)
- ✅ **Multi-Architecture**: Supports x64 and ARM64 on all platforms
- ✅ **Standard Formats**: No special extraction tools needed, works everywhere

## Package Managers

### npm/pnpm

```bash
# Install globally
npm install -g @1mcp/agent
# or
pnpm add -g @1mcp/agent

# Use directly
npx @1mcp/agent --config mcp.json
```

### Docker

We provide two Docker image variants:

- **`latest`**: Full-featured image with extra tools (uv, bun)
- **`lite`**: Lightweight image with basic Node.js package managers only

```bash
# Pull and run (full image) - IMPORTANT: Set host to 0.0.0.0 for Docker networking
docker run -p 3050:3050 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3050 \
  -e ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050 \
  -v $(pwd)/mcp.json:/app/mcp.json \
  ghcr.io/1mcp-app/agent:latest

# Pull and run (lite image) with proper networking
docker run -p 3050:3050 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3050 \
  -e ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050 \
  -v $(pwd)/mcp.json:/app/mcp.json \
  ghcr.io/1mcp-app/agent:lite

# For users in China - faster package installation
docker run -p 3050:3050 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3050 \
  -e ONE_MCP_EXTERNAL_URL=http://127.0.0.1:3050 \
  -e npm_config_registry=https://registry.npmmirror.com \
  -e UV_INDEX=http://mirrors.aliyun.com/pypi/simple \
  -e UV_DEFAULT_INDEX=http://mirrors.aliyun.com/pypi/simple \
  -v $(pwd)/mcp.json:/app/mcp.json \
  ghcr.io/1mcp-app/agent:latest

# With docker-compose (recommended)
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
      # Optional: For users in China mainland
      # - npm_config_registry=https://registry.npmmirror.com
      # - UV_INDEX=http://mirrors.aliyun.com/pypi/simple
      # - UV_DEFAULT_INDEX=http://mirrors.aliyun.com/pypi/simple
      # Optional: Behind corporate proxy
      # - https_proxy=${https_proxy}
      # - http_proxy=${http_proxy}
EOF

docker compose up -d
```

#### Available Tags

**Full-Featured Images:**

- `latest`, `vX.Y.Z`, `vX.Y`, `vX`, `sha-<commit>`

**Lightweight Images:**

- `lite`, `vX.Y.Z-lite`, `vX.Y-lite`, `vX-lite`, `sha-<commit>-lite`

## Build from Source

### Prerequisites

- Node.js (version from `.node-version` - currently 22)
- pnpm package manager

### Build Steps

```bash
# Clone repository
git clone https://github.com/1mcp-app/agent.git
cd agent

# Install dependencies
pnpm install

# Build
pnpm build

# Run
node build/index.js --config mcp.json
```

## Verification

Verify installation:

```bash
# Binary installation:
1mcp --version

# NPM installation:
npx @1mcp/agent --version
```

## System Requirements

**For Binary Installation:**

- **Memory**: 256MB RAM minimum, 1GB recommended
- **Disk**: Minimal space (single binary + config files)
- **Network**: HTTP/HTTPS outbound access for MCP servers
- **OS**: Linux (x64/ARM64), Windows (x64), macOS (ARM64/x64)

**For NPM Installation:**

- **Memory**: 512MB RAM minimum, 2GB recommended
- **Disk**: Space for Node.js dependencies and logs
- **Network**: HTTP/HTTPS outbound access for MCP servers
- **OS**: Linux (x64/ARM64), macOS (ARM64/x64), Windows (x64)
- **Runtime**: Node.js 21+

## Next Steps

- [Quick Start Guide](/guide/quick-start) - Get running in 5 minutes
- [Configuration](/guide/essentials/configuration) - Detailed setup options
