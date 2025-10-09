import { ChildProcess } from 'child_process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export interface McpClientConfig {
  transport: 'stdio' | 'sse';
  stdioConfig?: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
  sseConfig?: {
    url: string;
    headers?: Record<string, string>;
  };
}

export class McpTestClient {
  private client: Client;
  private transport!: StdioClientTransport | SSEClientTransport;
  private process?: ChildProcess;

  constructor(private config: McpClientConfig) {
    this.client = new Client(
      {
        name: 'test-client',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );
  }

  async connect(): Promise<void> {
    if (this.config.transport === 'stdio') {
      if (!this.config.stdioConfig) {
        throw new Error('stdio config required for stdio transport');
      }

      this.transport = new StdioClientTransport({
        command: this.config.stdioConfig.command,
        args: this.config.stdioConfig.args,
        env: this.config.stdioConfig.env,
      });
    } else {
      if (!this.config.sseConfig) {
        throw new Error('SSE config required for SSE transport');
      }

      this.transport = new SSEClientTransport(new URL(this.config.sseConfig.url), this.config.sseConfig.headers);
    }

    await this.client.connect(this.transport);
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
    }
  }

  async listTools() {
    return await this.client.request({ method: 'tools/list' }, ListToolsRequestSchema);
  }

  async listResources() {
    return await this.client.request({ method: 'resources/list' }, ListResourcesRequestSchema);
  }

  async callTool(name: string, arguments_?: Record<string, unknown>) {
    return await this.client.request(
      {
        method: 'tools/call',
        params: {
          name,
          arguments: arguments_ || {},
        },
      },
      CallToolRequestSchema,
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.request({ method: 'ping' }, { type: 'object' } as any);
      return true;
    } catch {
      return false;
    }
  }

  async sendCustomRequest(method: string, params?: Record<string, unknown>) {
    return await this.client.request(
      {
        method,
        params,
      },
      { type: 'object' } as any,
    );
  }

  getClient(): Client {
    return this.client;
  }
}
