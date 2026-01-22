import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';

export interface SimpleMcpClientConfig {
  transport: 'stdio';
  stdioConfig: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
  context?: {
    sessionId?: string;
    environment?: {
      variables?: Record<string, string>;
    };
    project?: {
      name?: string;
      path?: string;
    };
    [key: string]: unknown;
  };
}

/**
 * Simple MCP client for testing that bypasses MCP SDK validation bugs
 *
 * This client uses raw JSON-RPC 2.0 protocol without the strict validation
 * that causes issues in the MCP SDK v1.25.2.
 */
export class SimpleMcpClient extends EventEmitter {
  private process: ChildProcess;
  private id = 1;
  private responses: Map<number, any> = new Map();
  private buffer = '';

  constructor(private config: SimpleMcpClientConfig) {
    super();
    this.process = spawn(config.stdioConfig.command, config.stdioConfig.args || [], {
      env: { ...process.env, ...config.stdioConfig.env },
    });

    this.process.stdout?.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on('data', () => {
      // Debug output (can be enabled for troubleshooting)
      // console.error('[stderr]', data.toString());
    });

    this.process.on('error', (error) => {
      this.emit('error', error);
    });

    this.process.on('exit', (code) => {
      this.emit('exit', code);
    });
  }

  private processBuffer() {
    const lines = this.buffer.split('\n');
    let completeLines = 0;

    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].trim()) continue;

      try {
        const response = JSON.parse(lines[i]);
        if (response.id !== undefined) {
          this.responses.set(response.id, response);
          this.emit(`response-${response.id}`, response);
        }
        // Handle notifications
        else if (response.method) {
          this.emit('notification', response);
        }
        completeLines = i + 1;
      } catch {
        // Skip invalid JSON
        // console.warn('[SimpleMcpClient] Failed to parse:', lines[i]);
      }
    }

    if (completeLines > 0) {
      this.buffer = lines.slice(completeLines).join('\n');
    }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<any> {
    const id = this.id++;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params: params || {},
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout: ${method}`));
      }, 10000);

      this.once(`response-${id}`, (response) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(`${response.error.code}: ${response.error.message}`));
        } else {
          resolve(response.result);
        }
      });

      this.process.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  async initialize(): Promise<void> {
    const initParams: Record<string, unknown> = {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'test-client', version: '1.0.0' },
    };

    // Add context if provided
    if (this.config.context) {
      (initParams as any).context = this.config.context;
    }

    const result = await this.request('initialize', initParams);

    if (!result) {
      throw new Error('Failed to initialize');
    }
  }

  async connect(): Promise<void> {
    return this.initialize();
  }

  async listTools(): Promise<any> {
    return await this.request('tools/list');
  }

  async listResources(): Promise<any> {
    return await this.request('resources/list');
  }

  async listPrompts(): Promise<any> {
    return await this.request('prompts/list');
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<any> {
    return await this.request('tools/call', {
      name,
      arguments: args || {},
    });
  }

  async sendCustomRequest(method: string, params?: Record<string, unknown>): Promise<any> {
    return await this.request(method, params);
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
    }
  }

  getProcess(): ChildProcess {
    return this.process;
  }
}
