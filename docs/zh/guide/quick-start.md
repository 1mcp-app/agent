# 快速入门

在 5 分钟内使用基本配置让 1MCP 运行起来。

## 先决条件

- Node.js 18+

## 基本设置

1.  **创建配置**

    ```bash
    # 创建一个基本的配置文件
    cat > mcp.json << 'EOF'
    {
      "mcpServers": {
        "filesystem": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          "tags": ["local", "files"]
        }
      }
    }
    EOF
    ```

2.  **启动服务器**

    ```bash
    npx -y @1mcp/agent --config mcp.json --port 3000
    ```

3.  **测试连接**

    服务器现在正在端口 3000 上运行。您现在可以将您的 MCP 客户端连接到此端口。

就是这样！您的 1MCP 代理现在正在运行并聚合 MCP 服务器。

## 项目配置

**对于仅支持 STDIO 传输的 MCP 客户端**（如 Claude Desktop），您可以使用项目配置来简化代理连接。

### 何时使用项目配置

当您的 MCP 客户端满足以下条件时使用 `.1mcprc`：

- 无法直接连接到 HTTP/SSE 端点
- 仅支持 STDIO 传输
- 需要连接到运行中的 1MCP 服务器

**先决条件**：您必须运行一个 1MCP 服务器（`npx -y @1mcp/agent serve`）以供代理连接。

对于定期使用代理命令的项目，创建 `.1mcprc` 文件来设置默认连接设置：

```bash
# 创建包含预设的项目配置
echo '{"preset": "my-setup"}' > .1mcprc

# 现在只需运行：
npx -y @1mcp/agent proxy
```

我们建议使用预设以获得更好的配置管理。详情请参阅[代理命令](/zh/commands/proxy)文档。

## 下一步

- [启用认证](/zh/guide/advanced/authentication) 用于生产环境
- [添加更多服务器](/zh/guide/essentials/configuration) 以扩展功能
- [配置项目设置](/zh/commands/proxy#项目配置-1mcprc) 用于团队协作

## 常见问题

**服务器启动失败？**

- 检查是否安装了 Node.js 18+：`node --version`
- 验证配置文件是否为有效的 JSON：`cat mcp.json | jq`

**无法连接到 MCP 服务器？**

- 确保服务器命令是可执行的
- 检查服务器日志以获取特定的错误消息
