# 健康检查 API 参考

1MCP 代理提供全面的健康检查端点，用于监控系统状态、服务器连接和操作指标。

## 概述

健康检查端点专为以下目的而设计：

- **负载均衡器**：HAProxy、nginx、AWS ALB
- **容器编排**：Kubernetes、Docker Swarm
- **CI/CD 管道**：部署验证
- **手动调试**：系统状态检查

## 安全配置

健康端点包括可配置的安全功能，以控制信息暴露：

**详细级别**：

- **`full`**：完整的系统信息，带有错误清理功能
- **`basic`**：有限的系统详细信息、经过清理的错误、服务器状态
- **`minimal`**（默认）：仅包含必要的状态信息，无敏感详细信息

**配置**：

```bash
# CLI 选项（默认为 minimal）
npx -y @1mcp/agent --config mcp.json --health-info-level basic

# 环境变量
export ONE_MCP_HEALTH_INFO_LEVEL=basic
npx -y @1mcp/agent --config mcp.json
```

**清理功能**：

- 自动错误消息清理
- 删除凭据模式（user:password@、令牌、密钥）
- URL 和文件路径编辑
- IP 地址匿名化

## 端点

### `GET /health`

**描述**：完整的健康状态，包含详细的系统指标和服务器信息。

**身份验证**：无需

**响应代码**：

- `200` - 健康或已降级但功能正常
- `503` - 不健康，存在严重问题
- `500` - 内部服务器错误

**响应标头**：

```http
Content-Type: application/json
Cache-Control: no-cache, no-store, must-revalidate
X-Health-Status: healthy|degraded|unhealthy
X-Service-Version: 0.15.0
X-Uptime-Seconds: 3600
```

**响应模式**：

```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2025-01-30T12:00:00.000Z",
  "version": "0.15.0",
  "system": {
    "uptime": 3600,
    "memory": {
      "used": 50.5,
      "total": 100.0,
      "percentage": 50.5
    },
    "process": {
      "pid": 12345,
      "nodeVersion": "v20.0.0",
      "platform": "linux",
      "arch": "x64"
    }
  },
  "servers": {
    "total": 3,
    "healthy": 2,
    "unhealthy": 1,
    "details": [
      {
        "name": "filesystem-server",
        "status": "connected|error|disconnected|awaiting_oauth",
        "healthy": true,
        "lastConnected": "2025-01-30T11:30:00.000Z",
        "lastError": "Connection timeout",
        "tags": ["filesystem", "local"]
      }
    ]
  },
  "configuration": {
    "loaded": true,
    "serverCount": 3,
    "enabledCount": 2,
    "disabledCount": 1,
    "authEnabled": true,
    "transport": "http"
  }
}
```

**字段描述**：

- **`status`**：整体健康状态
  - `healthy` - 所有系统均可运行
  - `degraded` - 存在一些问题，但仍可正常运行
  - `unhealthy` - 存在影响功能的严重问题

- **`system.uptime`**：服务器正常运行时间（秒）
- **`system.memory.used`**：已用堆内存（MB）
- **`system.memory.total`**：总堆内存（MB）
- **`system.memory.percentage`**：内存使用百分比

- **`servers.details[].status`**：单个服务器状态
  - `connected` - 服务器已连接且可运行
  - `error` - 服务器存在连接或运行时错误
  - `disconnected` - 服务器未连接
  - `awaiting_oauth` - 服务器需要 OAuth 身份验证

### `GET /health/live`

**描述**：用于基本可用性检查的简单活动性探针。

**身份验证**：无需

**响应代码**：

- `200` - 服务器正在运行（如果可访问，则始终返回 200）

**响应模式**：

```json
{
  "status": "alive",
  "timestamp": "2025-01-30T12:00:00.000Z"
}
```

**用例**：

- Kubernetes 活动性探针
- 负载均衡器基本健康检查
- 服务发现健康检查

### `GET /health/ready`

**描述**：就绪性探针，用于确定服务是否已准备好接受请求。

**身份验证**：无需

**响应代码**：

- `200` - 服务已就绪（配置已加载）
- `503` - 服务未就绪

**响应模式**：

```json
{
  "status": "ready|not_ready",
  "timestamp": "2025-01-30T12:00:00.000Z",
  "configuration": {
    "loaded": true,
    "serverCount": 3,
    "enabledCount": 2,
    "disabledCount": 1,
    "authEnabled": true,
    "transport": "http"
  },
  "backendSupervision": {
    "total": 2,
    "connected": 2,
    "restarting": 0,
    "crashLoop": 0,
    "stopped": 0
  }
}
```

任何受监督的 stdio 后端处于 `restarting` 或 `crash-loop` 状态时，就绪检查都会返回 `503`。`backendSupervision` 的结构遵循健康信息详细级别：`minimal` 返回聚合计数，`basic` 返回不含 PID 且错误已清理的逐后端信息，`full` 返回经过清理的完整信息。

**用例**：

- Kubernetes 就绪性探针
- 负载均衡器就绪性检查
- 部署验证

### `GET /health/mcp` 和 `GET /health/mcp/:serverName`

加载管理器可用时，这些端点会报告 MCP 加载进度和受监督后端状态。集合端点包含加载摘要和 `backendSupervision`；受监督后端正在重启或进入 crash-loop 时，服务器专用端点返回 `503`。监督输出遵循上述 `minimal`、`basic` 和 `full` 信息披露策略。

## 健康状态逻辑

### 整体状态确定

整体健康状态由以下因素确定：

1. **配置状态**：必须加载才能处于 `healthy` 或 `degraded` 状态
2. **服务器健康比率**：
   - 所有服务器都健康 → `healthy`
   - 未配置服务器 → `degraded`
   - > 50% 的服务器健康 → `degraded`
   - ≤50% 的服务器健康 → `unhealthy`

### 服务器健康分类

单个服务器在以下情况下被视为健康：

- 状态为 `connected`
- 最近没有严重错误
- 响应健康检查

## 速率限制

健康端点的速率限制较为宽松：

- **窗口**：5 分钟
- **限制**：每个 IP 200 个请求
- **标头**：包含标准速率限制标头

## 监控集成示例

### Kubernetes 健康探针

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: 1mcp-agent
spec:
  template:
    spec:
      containers:
        - name: 1mcp
          image: ghcr.io/1mcp-app/agent:latest
          ports:
            - containerPort: 3050
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3050
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3050
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
```

### Docker Compose 健康检查

```yaml
version: '3.8'
services:
  1mcp:
    image: ghcr.io/1mcp-app/agent:latest
    ports:
      - '3050:3050'
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3050/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

### HAProxy 后端健康检查

```
backend 1mcp_servers
    balance roundrobin
    option httpchk GET /health/ready
    http-check expect status 200
    server 1mcp-1 1mcp-1:3050 check inter 30s
    server 1mcp-2 1mcp-2:3050 check inter 30s
```

### 基于脚本的监控

```bash
#!/bin/bash
# 简单的健康检查脚本

HEALTH_URL="http://localhost:3050/health"
RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/health.json "$HEALTH_URL")
HTTP_CODE="${RESPONSE: -3}"

if [ "$HTTP_CODE" -eq 200 ]; then
    STATUS=$(jq -r '.status' /tmp/health.json)
    UNHEALTHY=$(jq -r '.servers.unhealthy' /tmp/health.json)

    echo "1MCP Health: $STATUS (Unhealthy servers: $UNHEALTHY)"

    if [ "$STATUS" = "unhealthy" ]; then
        exit 1
    fi
else
    echo "1MCP Health Check Failed: HTTP $HTTP_CODE"
    exit 1
fi
```

## 错误响应

### 服务不可用 (503)

```json
{
  "status": "unhealthy",
  "timestamp": "2025-01-30T12:00:00.000Z",
  "version": "0.15.0",
  "system": {/* system info */},
  "servers": {
    "total": 3,
    "healthy": 0,
    "unhealthy": 3,
    "details": [/* server details */]
  },
  "configuration": {
    "loaded": false,
    "serverCount": 0,
    "enabledCount": 0,
    "disabledCount": 0,
    "authEnabled": false,
    "transport": "http"
  }
}
```

### 内部服务器错误 (500)

```json
{
  "status": "unhealthy",
  "timestamp": "2025-01-30T12:00:00.000Z",
  "error": "Health check failed",
  "message": "Configuration service unavailable"
}
```

## 安全注意事项

### 生产部署

**网络级保护**（推荐）：

- 仅将健康端点限制为监控网络
- 使用防火墙规则限制对受信任 IP 的访问
- 考虑使用 VPN 或专用网络访问详细端点

**信息暴露控制**：

- 对面向公众的部署使用 `basic` 或 `minimal` 详细级别
- `full` 详细级别仅建议用于专用网络
- 始终启用错误清理以防止凭据泄漏

**示例安全配置**：

```bash
# 开发环境
npx -y @1mcp/agent --config mcp.json --health-info-level full

# 暂存环境
npx -y @1mcp/agent --config mcp.json --health-info-level basic

# 生产环境（默认的 minimal 级别是安全的）
npx -y @1mcp/agent --config mcp.json
```

### 详细级别影响

| 级别      | 系统信息   | 服务器详细信息 | 后端监督信息     | 错误消息 | 用例            |
| --------- | ---------- | -------------- | ---------------- | -------- | --------------- |
| `full`    | 完整       | 完整 + 已清理  | 完整，包括 PID   | 已清理   | 内部监控        |
| `basic`   | 有限       | 状态 + 已清理  | 逐后端，不含 PID | 已清理   | 受限监控        |
| `minimal` | 仅基本信息 | 仅计数         | 仅聚合状态计数   | 无       | 公共/负载均衡器 |

## 最佳实践

### 监控设置

1. **使用多个端点**：结合使用 `/health`、`/health/live` 和 `/health/ready` 进行全面监控
2. **设置适当的超时**：健康检查应在 5-10 秒内完成
3. **配置重试逻辑**：允许 2-3 次重试，并采用指数退避策略
4. **监控趋势**：跟踪健康状态随时间的变化
5. **安全第一**：为您的网络暴露选择适当的详细级别

### 开发测试

```bash
# 测试所有健康端点
curl -v http://localhost:3050/health
curl -v http://localhost:3050/health/live
curl -v http://localhost:3050/health/ready

# 检查响应标头
curl -I http://localhost:3050/health

# 监控健康状态
watch -n 5 'curl -s http://localhost:3050/health | jq ".status, .servers.healthy, .servers.unhealthy"'
```
