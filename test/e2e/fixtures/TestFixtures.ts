import { MockApp, MockMcpServer } from '@test/e2e/utils/index.js';

/**
 * Test fixtures for creating consistent test scenarios
 */
export class TestFixtures {
  /**
   * Common MCP server configurations for testing
   */
  static getMockMcpServers(): {
    [key: string]: MockMcpServer;
  } {
    return {
      echoServer: {
        name: 'echo-server',
        command: 'echo',
        args: ['Hello MCP'],
        tags: ['test', 'basic'],
        type: 'stdio',
      },
      nodeVersionServer: {
        name: 'node-version',
        command: 'node',
        args: ['--version'],
        tags: ['test', 'node'],
        type: 'stdio',
      },
      disabledServer: {
        name: 'disabled-server',
        command: 'echo',
        args: ['Disabled'],
        tags: ['test', 'disabled'],
        type: 'stdio',
        disabled: true,
      },
      httpServer: {
        name: 'http-server',
        command: '', // HTTP servers don't need command but interface requires it
        type: 'http',
        url: 'http://localhost:3000/mcp',
        tags: ['test', 'http'],
      },
      pythonServer: {
        name: 'python-server',
        command: 'python',
        args: ['-c', 'print("Python MCP Server")'],
        tags: ['test', 'python'],
        type: 'stdio',
      },
      taggedServer: {
        name: 'multi-tag-server',
        command: 'echo',
        args: ['Multi-tagged'],
        tags: ['production', 'database', 'critical'],
        type: 'stdio',
      },
    };
  }

  /**
   * Get a list of mock MCP servers for different test scenarios
   */
  static getServerList(scenario: 'empty' | 'basic' | 'mixed' | 'complex' | 'disabled-only'): MockMcpServer[] {
    const servers = this.getMockMcpServers();

    switch (scenario) {
      case 'empty':
        return [];

      case 'basic':
        return [servers.echoServer];

      case 'mixed':
        return [servers.echoServer, servers.disabledServer];

      case 'complex':
        return [servers.echoServer, servers.httpServer, servers.disabledServer];

      case 'disabled-only':
        return [servers.disabledServer];

      default:
        return [servers.echoServer];
    }
  }

  /**
   * Mock application configurations for testing app discovery
   */
  static getMockApps(): {
    [key: string]: MockApp;
  } {
    return {
      vsCode: {
        name: 'vscode',
        path: '/Applications/Visual Studio Code.app',
        type: 'vs-code',
        settings: {
          'mcp.servers': {
            'test-server': {
              command: 'node',
              args: ['test-server.js'],
            },
          },
        },
      },
      cursor: {
        name: 'cursor',
        path: '/Applications/Cursor.app',
        type: 'cursor',
        settings: {
          'mcp.servers': {
            'cursor-server': {
              command: 'python',
              args: ['cursor_server.py'],
            },
          },
        },
      },
      claudeDesktop: {
        name: 'claude-desktop',
        path: '/Applications/Claude.app',
        type: 'claude-desktop',
        settings: {
          mcpServers: {
            'claude-server': {
              command: 'node',
              args: ['claude-server.js'],
            },
          },
        },
      },
      emptyVsCode: {
        name: 'empty-vscode',
        path: '/Applications/Visual Studio Code Empty.app',
        type: 'vs-code',
        settings: {
          'mcp.servers': {},
        },
      },
    };
  }

  /**
   * Get a list of mock apps for different test scenarios
   */
  static getAppList(scenario: 'empty' | 'single' | 'multiple' | 'mixed-types'): MockApp[] {
    const apps = this.getMockApps();

    switch (scenario) {
      case 'empty':
        return [];

      case 'single':
        return [apps.vsCode];

      case 'multiple':
        return [apps.vsCode, apps.emptyVsCode];

      case 'mixed-types':
        return [apps.vsCode, apps.cursor, apps.claudeDesktop];

      default:
        return [apps.vsCode];
    }
  }

  /**
   * Common CLI argument combinations for testing
   */
  static getCommonArgs(): {
    [key: string]: string[];
  } {
    return {
      verbose: ['--verbose'],
      showDisabled: ['--show-disabled'],
      verboseShowDisabled: ['--verbose', '--show-disabled'],
      tags: ['--tags', 'test'],
      multipleTags: ['--tags', 'test,basic'],
      help: ['--help'],
      version: ['--version'],
      json: ['--output', 'json'],
      quiet: ['--quiet'],
    };
  }

  /**
   * Expected output patterns for validation
   */
  static getExpectedOutputPatterns(): {
    [key: string]: RegExp;
  } {
    return {
      serverList: /📋 MCP Servers/,
      noServers: /No MCP servers are configured/,
      enabledServer: /🟢.*Enabled/,
      disabledServer: /🔴.*Disabled/,
      summary: /📊 Summary:/,
      helpText: /Usage:/,
      errorMessage: /❌/,
      successMessage: /✅/,
      warningMessage: /⚠️/,
      infoMessage: /ℹ️/,
      appDiscovered: /Found.*applications/,
      backupCreated: /Backup created/,
      configUpdated: /Configuration updated/,
    };
  }

  /**
   * Common error scenarios for testing
   */
  static getErrorScenarios(): {
    [key: string]: {
      description: string;
      args: string[];
      expectedExitCode?: number;
      expectedPattern?: RegExp;
    };
  } {
    return {
      invalidConfig: {
        description: 'Invalid config file path',
        args: ['--config', '/nonexistent/config.json'],
        expectedExitCode: 1,
        expectedPattern: /Failed to.*config/i,
      },
      invalidTags: {
        description: 'Invalid tags format',
        args: ['--tags', ''],
        expectedExitCode: 1,
        expectedPattern: /Invalid.*tags/i,
      },
      invalidCommand: {
        description: 'Invalid subcommand',
        args: ['invalid-command'],
        expectedExitCode: 1,
      },
      missingArgument: {
        description: 'Missing required argument',
        args: [], // Context-dependent
        expectedExitCode: 1,
      },
    };
  }

  /**
   * Create a complete test scenario with environment config
   */
  static createTestScenario(
    name: string,
    serverScenario: 'empty' | 'basic' | 'mixed' | 'complex' | 'disabled-only' = 'basic',
    appScenario: 'empty' | 'single' | 'multiple' | 'mixed-types' = 'empty',
  ) {
    return {
      name,
      createConfigFile: true,
      mockMcpServers: this.getServerList(serverScenario),
      mockApps: this.getAppList(appScenario),
      envOverrides: {
        TEST_SCENARIO: name,
      },
    };
  }

  /**
   * Mock server fixtures for testing actual server communication
   */
  static getMockServerFixtures(): {
    [key: string]: {
      path: string;
      content: string;
    };
  } {
    return {
      echoServer: {
        path: 'echo-server.js',
        content: `#!/usr/bin/env node
// Simple echo server for testing
process.stdin.on('data', (data) => {
  process.stdout.write(data);
});
`,
      },
      errorServer: {
        path: 'error-server.js',
        content: `#!/usr/bin/env node
// Server that always returns errors
console.error('Mock server error');
process.exit(1);
`,
      },
      slowServer: {
        path: 'slow-server.js',
        content: `#!/usr/bin/env node
// Server with artificial delay
setTimeout(() => {
  console.log('Slow server ready');
}, 2000);
`,
      },
    };
  }
}
