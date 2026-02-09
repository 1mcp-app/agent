/**
 * E2E tests for tool_invoke and tool_schema with template MCP servers
 *
 * This test file validates that the lazy loading meta-tools work correctly
 * with template-based MCP servers, including:
 * - Per-client template servers (with sessionId in key)
 * - Shareable template servers (with renderedHash in key)
 * - Static servers (no suffix in key)
 *
 * Uses HTTP transport with MCP SDK for realistic testing with proper context data.
 */
import { McpTestClient, TestProcessManager } from '@test/e2e/utils/index.js';

import { randomBytes } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Helper to create agent config with lazy loading enabled
function createAgentConfig(lazyLoadingEnabled: boolean): string {
  const config = {
    lazyLoading: {
      enabled: lazyLoadingEnabled,
      mode: 'metatool',
      inlineCatalog: false,
      catalogFormat: 'flat',
      directExpose: [],
      cache: {
        maxEntries: 1000,
        strategy: 'lru',
      },
      preload: {
        patterns: [],
        keywords: [],
      },
      fallback: {
        onError: 'skip',
        timeoutMs: 5000,
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

// Helper to create MCP server config with template servers
function createMcpServerConfig(mockServerPath: string) {
  const mcpServers: Record<string, any> = {};

  // Static server for baseline testing
  mcpServers['static-server'] = {
    transport: 'stdio',
    command: 'node',
    args: [mockServerPath, 'static-server'],
    tags: ['static'],
  };

  // Return config with both mcpServers and mcpTemplates
  return {
    templateSettings: {
      cacheContext: true,
    },
    mcpServers,
    mcpTemplates: {
      'template-server': {
        transport: 'stdio',
        command: 'node',
        args: [mockServerPath, 'template-server'],
        tags: ['template'],
        env: {
          SESSION_ID: '{{sessionId}}',
          USER_ID: '{{userId}}',
        },
        template: {
          shareable: true, // Shareable template server
        },
      },
      'per-client-template': {
        transport: 'stdio',
        command: 'node',
        args: [mockServerPath, 'per-client-template'],
        tags: ['template', 'per-client'],
        env: {
          CLIENT_SESSION: '{{sessionId}}',
        },
        template: {
          shareable: false, // Per-client template server
        },
      },
    },
  };
}

/**
 * Helper function to wait for server to be ready with retry logic
 */
async function waitForServerReady(
  healthUrl: string,
  options: { maxAttempts?: number; retryDelay?: number; requestTimeout?: number } = {},
): Promise<void> {
  const { maxAttempts = 50, retryDelay = 300, requestTimeout = 5000 } = options;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, retryDelay));

    try {
      const healthResponse = await fetch(healthUrl, {
        signal: AbortSignal.timeout(requestTimeout),
      });
      if (healthResponse.ok) {
        return;
      }
    } catch {
      // Continue retrying
    }
  }

  throw new Error(`Server failed to start after ${maxAttempts} attempts`);
}

/**
 * Generate a random port in the range 10000-60000
 */
function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

describe('Lazy Tools with Template MCP Servers E2E Tests', () => {
  let processManager: TestProcessManager;
  let configDir: string;
  let httpPort: number;
  let serverUrl: string;

  beforeEach(async () => {
    // Create temporary config directory
    const buildDir = join(process.cwd(), 'build');
    await mkdir(buildDir, { recursive: true });
    configDir = join(buildDir, `.tmp-test-lazy-template-${randomBytes(4).toString('hex')}`);
    await mkdir(configDir, { recursive: true });

    // Create MCP server configuration with template servers
    const mockServerPath = resolve(__dirname, 'utils/mock-mcp-server-fast.js');
    const mcpConfig = createMcpServerConfig(mockServerPath);
    await writeFile(join(configDir, 'mcp.json'), JSON.stringify(mcpConfig, null, 2), 'utf-8');

    // Create agent config with lazy loading enabled
    const agentConfig = createAgentConfig(true);
    await writeFile(join(configDir, 'agent.json'), agentConfig, 'utf-8');

    // Initialize process manager with a random port
    processManager = new TestProcessManager();
    httpPort = getRandomPort();
    serverUrl = `http://localhost:${httpPort}/mcp`;
  });

  afterEach(async () => {
    await processManager.cleanup();
    // Clean up the test directory
    try {
      await rm(configDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper function to start 1MCP server with HTTP transport
   */
  async function startHttpServer(options: { enableLazyLoading: boolean }): Promise<void> {
    const args = [
      resolve(__dirname, '../../build/index.js'),
      'serve',
      '--transport',
      'http',
      '--port',
      String(httpPort),
      '--config-dir',
      configDir,
    ];

    if (options.enableLazyLoading) {
      args.push('--enable-lazy-loading');
    }

    const env: Record<string, string> = {
      ONE_MCP_CONFIG_DIR: configDir,
      NODE_ENV: 'test',
      ONE_MCP_LOG_LEVEL: 'info',
      ONE_MCP_ENABLE_AUTH: 'false',
    };

    // Start the server process
    await processManager.startProcess('1mcp-server', {
      command: 'node',
      args,
      env,
      startupTimeout: 60000,
    });

    // Wait for server to be ready
    await waitForServerReady(`http://localhost:${httpPort}/health`);
  }

  /**
   * Helper function to create MCP client connected to the test server via HTTP
   * Uses McpTestClient with streamable-http transport
   */
  function createHttpClient(tags?: string[]): McpTestClient {
    // Build URL with optional tags query parameter
    let url = serverUrl;
    if (tags && tags.length > 0) {
      url = `${serverUrl}?tags=${tags.join(',')}`;
    }
    return new McpTestClient({
      transport: 'streamable-http',
      streamableHttpConfig: {
        url,
      },
    });
  }

  describe('tool_list with template servers', () => {
    it('should list tools from template servers using tool_list meta-tool', async () => {
      await startHttpServer({ enableLazyLoading: true });

      const client = createHttpClient();
      try {
        await client.connect();

        // Call the tool_list meta-tool
        const result = (await client.callTool('tool_list', {})) as any;

        console.log('tool_list result:', JSON.stringify(result, null, 2));

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);

        // Parse the structured content
        const content = result.content[0];
        expect(content.type).toBe('text');

        const parsed = JSON.parse(content.text);
        expect(parsed).toHaveProperty('tools');
        expect(parsed).toHaveProperty('totalCount');
        expect(parsed).toHaveProperty('servers');
        expect(parsed).toHaveProperty('hasMore');

        // Verify no error in response
        if (parsed.error) {
          console.error('Error in tool_list:', parsed.error);
        }
        expect(parsed.error).toBeUndefined();

        // Should have at least static server
        expect(parsed.servers.length).toBeGreaterThan(0);
        expect(parsed.servers).toContain('static-server');

        console.log('Available servers:', parsed.servers);
        console.log('Total tools:', parsed.totalCount);
      } finally {
        await client.disconnect();
      }
    }, 60000);
  });

  describe('tool_schema with template servers', () => {
    it('should get schema for tools from template servers using tool_schema meta-tool', async () => {
      await startHttpServer({ enableLazyLoading: true });

      const client = createHttpClient();
      try {
        await client.connect();

        // First get the list of tools to find a template server tool
        const toolListResult = (await client.callTool('tool_list', {})) as any;
        const toolListContent = JSON.parse(toolListResult.content[0].text);

        console.log('Available tools for schema test:', JSON.stringify(toolListContent, null, 2));

        // Find a tool from any server (static or template)
        const anyServerTool = toolListContent.tools?.[0];

        if (!anyServerTool) {
          console.warn('No server tools found, skipping schema test');
          return;
        }

        console.log('Testing tool_schema for:', anyServerTool.server, anyServerTool.name);

        // Call tool_schema to get the full schema
        const result = (await client.callTool('tool_schema', {
          server: anyServerTool.server,
          toolName: anyServerTool.name,
        })) as any;

        console.log('tool_schema result:', JSON.stringify(result, null, 2));

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);

        const content = result.content[0];
        expect(content.type).toBe('text');

        const parsed = JSON.parse(content.text);
        expect(parsed).toHaveProperty('schema');

        // Verify no error
        if (parsed.error) {
          console.error('Error in tool_schema:', parsed.error);
          console.error('Server:', anyServerTool.server);
          console.error('Tool:', anyServerTool.name);
        }
        expect(parsed.error).toBeUndefined();

        // Verify schema structure
        if (!parsed.error) {
          expect(parsed.schema).toBeDefined();
          expect(parsed.schema).toHaveProperty('name');
          expect(parsed.schema).toHaveProperty('inputSchema');
        }
      } finally {
        await client.disconnect();
      }
    }, 60000);

    it('should handle template server tools if they exist', async () => {
      await startHttpServer({ enableLazyLoading: true });

      const client = createHttpClient(['template']);
      try {
        await client.connect();

        // Get tools filtered by template tag
        const toolListResult = (await client.callTool('tool_list', {})) as any;
        const toolListContent = JSON.parse(toolListResult.content[0].text);

        console.log('Template-filtered tools:', JSON.stringify(toolListContent, null, 2));

        // Find a template server tool
        const templateServerTool = toolListContent.tools?.find(
          (tool: any) => tool.server && tool.server.includes('template'),
        );

        if (templateServerTool) {
          console.log('Found template server tool:', templateServerTool);

          // Get schema for template server tool
          const result = (await client.callTool('tool_schema', {
            server: templateServerTool.server,
            toolName: templateServerTool.name,
          })) as any;

          const parsed = JSON.parse(result.content[0].text);

          // Should successfully get schema without errors
          expect(parsed.error).toBeUndefined();
          expect(parsed.schema).toBeDefined();
          expect(parsed.schema.name).toBe(templateServerTool.name);
        } else {
          console.log('No template servers instantiated (requires proper context)');
        }
      } finally {
        await client.disconnect();
      }
    }, 60000);
  });

  describe('tool_invoke with template servers', () => {
    it('should invoke tools from servers using tool_invoke meta-tool', async () => {
      await startHttpServer({ enableLazyLoading: true });

      const client = createHttpClient();
      try {
        await client.connect();

        // First get the list of tools
        const toolListResult = (await client.callTool('tool_list', {})) as any;
        const toolListContent = JSON.parse(toolListResult.content[0].text);

        console.log('Available tools for invoke test:', JSON.stringify(toolListContent, null, 2));

        // Find any tool to test invocation
        const anyServerTool = toolListContent.tools?.[0];

        if (!anyServerTool) {
          console.warn('No server tools found, skipping invoke test');
          return;
        }

        console.log('Testing tool_invoke for:', anyServerTool.server, anyServerTool.name);

        // Call tool_invoke to execute the tool
        const result = (await client.callTool('tool_invoke', {
          server: anyServerTool.server,
          toolName: anyServerTool.name,
          args: { message: 'test message' },
        })) as any;

        console.log('tool_invoke result:', JSON.stringify(result, null, 2));

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);

        const content = result.content[0];
        expect(content.type).toBe('text');

        const parsed = JSON.parse(content.text);

        // Verify no error
        if (parsed.error) {
          console.error('Error in tool_invoke:', parsed.error);
          console.error('Server:', anyServerTool.server);
          console.error('Tool:', anyServerTool.name);
        }
        expect(parsed.error).toBeUndefined();

        // Verify result structure
        if (!parsed.error) {
          expect(parsed).toHaveProperty('result');
          expect(parsed).toHaveProperty('server');
          expect(parsed).toHaveProperty('tool');
          expect(parsed.server).toBe(anyServerTool.server);
          expect(parsed.tool).toBe(anyServerTool.name);
        }
      } finally {
        await client.disconnect();
      }
    }, 60000);

    it('should invoke template server tools if they exist', async () => {
      await startHttpServer({ enableLazyLoading: true });

      const client = createHttpClient(['template']);
      try {
        await client.connect();

        // Get tools filtered by template tag
        const toolListResult = (await client.callTool('tool_list', {})) as any;
        const toolListContent = JSON.parse(toolListResult.content[0].text);

        console.log('Template-filtered tools for invocation:', JSON.stringify(toolListContent, null, 2));

        // Find a template server tool
        const templateServerTool = toolListContent.tools?.find(
          (tool: any) => tool.server && tool.server.includes('template'),
        );

        if (templateServerTool) {
          console.log('Invoking template server tool:', templateServerTool);

          // Invoke the template server tool
          const result = (await client.callTool('tool_invoke', {
            server: templateServerTool.server,
            toolName: templateServerTool.name,
            args: { message: 'template test' },
          })) as any;

          const parsed = JSON.parse(result.content[0].text);

          // Should successfully invoke without errors
          expect(parsed.error).toBeUndefined();
          expect(parsed.result).toBeDefined();
          expect(parsed.server).toBe(templateServerTool.server);
          expect(parsed.tool).toBe(templateServerTool.name);
        } else {
          console.log('No template servers instantiated (requires proper context)');
        }
      } finally {
        await client.disconnect();
      }
    }, 60000);
  });

  describe('Error handling with template servers', () => {
    it('should handle non-existent server gracefully in tool_schema', async () => {
      await startHttpServer({ enableLazyLoading: true });

      const client = createHttpClient();
      try {
        await client.connect();

        // Try to get schema for a non-existent server
        const result = (await client.callTool('tool_schema', {
          server: 'non-existent-server',
          toolName: 'fake_tool',
        })) as any;

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();

        const content = result.content[0];
        const parsed = JSON.parse(content.text);

        // Should have a structured error response
        expect(parsed).toHaveProperty('error');
        expect(parsed.error).toHaveProperty('type');
        expect(parsed.error.type).toBe('not_found');
      } finally {
        await client.disconnect();
      }
    }, 60000);

    it('should handle non-existent server gracefully in tool_invoke', async () => {
      await startHttpServer({ enableLazyLoading: true });

      const client = createHttpClient();
      try {
        await client.connect();

        // Try to invoke a tool on a non-existent server
        const result = (await client.callTool('tool_invoke', {
          server: 'non-existent-server',
          toolName: 'fake_tool',
          args: {},
        })) as any;

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();

        const content = result.content[0];
        const parsed = JSON.parse(content.text);

        // Should have a structured error response
        expect(parsed).toHaveProperty('error');
        expect(parsed.error).toHaveProperty('type');
        expect(parsed.error.type).toBe('not_found');
      } finally {
        await client.disconnect();
      }
    }, 60000);

    it('should handle validation errors in tool_invoke', async () => {
      await startHttpServer({ enableLazyLoading: true });

      const client = createHttpClient();
      try {
        await client.connect();

        // Try to invoke without required parameters
        const result = (await client.callTool('tool_invoke', {
          // Missing server and toolName
          args: {},
        } as any)) as any;

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();

        const content = result.content[0];
        const parsed = JSON.parse(content.text);

        // Should have a validation error
        expect(parsed).toHaveProperty('error');
        expect(parsed.error).toHaveProperty('type');
        expect(parsed.error.type).toBe('validation');
      } finally {
        await client.disconnect();
      }
    }, 60000);
  });

  describe('Session-scoped template server filtering', () => {
    it('should filter tools by tags correctly with tool_list', async () => {
      await startHttpServer({ enableLazyLoading: true });

      // Connect with only 'static' tag
      const client = createHttpClient(['static']);
      try {
        await client.connect();

        // Get tools - should filter by tag automatically
        const result = (await client.callTool('tool_list', {})) as any;

        const content = result.content[0];
        const parsed = JSON.parse(content.text);

        console.log('Tag-filtered tools:', JSON.stringify(parsed, null, 2));

        // Verify we got a valid response
        expect(parsed).toHaveProperty('tools');
        expect(parsed).toHaveProperty('servers');
        expect(Array.isArray(parsed.tools)).toBe(true);
        expect(Array.isArray(parsed.servers)).toBe(true);

        // Should only include static-server (filtered by 'static' tag)
        expect(parsed.servers).toContain('static-server');

        // Should NOT include servers without the 'static' tag
        const nonStaticServers = parsed.servers.filter((s: string) => !s.includes('static') && s !== 'static-server');
        expect(nonStaticServers.length).toBe(0);

        // All tools should be from servers accessible to this tag filter
        parsed.tools.forEach((tool: any) => {
          expect(tool).toHaveProperty('server');
          expect(typeof tool.server).toBe('string');
        });
      } finally {
        await client.disconnect();
      }
    }, 60000);
  });

  describe('Template server name formatting', () => {
    it('should use clean names for template servers (not hash-suffixed keys)', async () => {
      await startHttpServer({ enableLazyLoading: true });

      const client = createHttpClient();
      try {
        await client.connect();

        // Get all tools
        const result = (await client.callTool('tool_list', {})) as any;
        const parsed = JSON.parse(result.content[0].text);

        console.log('All servers:', parsed.servers);

        // Verify that server names do NOT contain hash suffixes
        // Template servers are stored with keys like "template-server:abc123"
        // but should appear in tool_list as "template-server" (clean name)
        for (const serverName of parsed.servers) {
          // Server names should not contain colons (which indicate hash suffixes)
          expect(serverName).not.toMatch(/:/);
          // Server names should not contain hash patterns
          expect(serverName).not.toMatch(/:[a-f0-9]+$/);
        }

        // Verify tools also use clean server names
        parsed.tools.forEach((tool: any) => {
          expect(tool.server).not.toMatch(/:/);
          expect(tool.server).not.toMatch(/:[a-f0-9]+$/);
        });
      } finally {
        await client.disconnect();
      }
    }, 60000);
  });
});
