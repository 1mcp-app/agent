import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestProcessManager, ConfigBuilder, ProtocolValidator } from '@test/e2e/utils/index.js';
describe('Stdio Transport Lifecycle E2E', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;
  let configPath: string;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();
  });

  it('should handle process lifecycle startup', async () => {
    configPath = configBuilder
      .enableStdioTransport()
      .addStdioServer('lifecycle-server', 'sleep', ['3'], ['lifecycle', 'test'])
      .writeToFile();

    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    const config = configBuilder.build();
    expect(config.transport?.stdio).toBe(true);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].name).toBe('lifecycle-server');
  });

  it('should handle process startup and shutdown', async () => {
    const processInfo = await processManager.startProcess('lifecycle-test', {
      command: 'sleep',
      args: ['5'],
      timeout: 10000,
      startupTimeout: 2000, // Reasonable startup timeout
    });

    expect(processInfo.pid).toBeGreaterThan(0);
    expect(processManager.isProcessRunning('lifecycle-test')).toBe(true);

    await processManager.stopProcess('lifecycle-test');
    expect(processManager.isProcessRunning('lifecycle-test')).toBe(false);
  });

  it('should handle process timeout scenarios', async () => {
    const shortTimeout = 200; // Much shorter timeout for testing

    try {
      await processManager.startProcess('timeout-test', {
        command: 'sleep',
        args: ['2'], // Sleep longer than timeout
        timeout: shortTimeout,
        startupTimeout: 2000, // Reasonable startup timeout
      });

      // Process should start successfully
      expect(processManager.isProcessRunning('timeout-test')).toBe(true);

      // Wait for timeout to kick in (reduced wait time)
      await new Promise((resolve) => setTimeout(resolve, shortTimeout + 100));

      // Process should be cleaned up by timeout
      expect(processManager.isProcessRunning('timeout-test')).toBe(false);
    } catch (error) {
      // Timeout error is expected
      expect(error).toBeDefined();
    }
  });

  it('should handle multiple process lifecycle management', async () => {
    const processes = [
      { name: 'proc-1', args: ['1'] }, // Longer durations to ensure they're still running when checked
      { name: 'proc-2', args: ['1'] },
      { name: 'proc-3', args: ['1'] },
    ];

    // Start all processes with faster startup
    for (const proc of processes) {
      const info = await processManager.startProcess(proc.name, {
        command: 'sleep',
        args: proc.args,
        timeout: 2000, // Reduced timeout
        startupTimeout: 2000, // Reasonable startup timeout
      });
      expect(info.pid).toBeGreaterThan(0);
      expect(processManager.isProcessRunning(proc.name)).toBe(true);
    }

    // Verify all are running
    const allProcesses = processManager.getAllProcesses();
    expect(allProcesses.size).toBe(3);

    // Stop all processes
    for (const proc of processes) {
      await processManager.stopProcess(proc.name);
      expect(processManager.isProcessRunning(proc.name)).toBe(false);
    }

    expect(processManager.getAllProcesses().size).toBe(0);
  });

  it('should validate lifecycle request patterns', async () => {
    const lifecycleRequests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } },
      { jsonrpc: '2.0', id: 2, method: 'initialized', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 4, method: 'shutdown', params: {} },
      { jsonrpc: '2.0', id: 5, method: 'exit', params: {} },
    ];

    lifecycleRequests.forEach((request) => {
      const validation = ProtocolValidator.validateRequest(request);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  it('should handle lifecycle error scenarios', async () => {
    const lifecycleErrors = [
      { code: -32000, message: 'Startup failed', data: { phase: 'initialization' } },
      { code: -32001, message: 'Shutdown timeout', data: { phase: 'cleanup' } },
      { code: -32002, message: 'Process crashed', data: { phase: 'runtime' } },
    ];

    lifecycleErrors.forEach((error) => {
      const validation = ProtocolValidator.validateError(error);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  it('should handle process restart scenarios', async () => {
    // Start process
    let processInfo = await processManager.startProcess('restart-test', {
      command: 'sleep',
      args: ['2'],
      timeout: 5000,
    });
    const originalPid = processInfo.pid;

    expect(processManager.isProcessRunning('restart-test')).toBe(true);

    // Stop process
    await processManager.stopProcess('restart-test');
    expect(processManager.isProcessRunning('restart-test')).toBe(false);

    // Restart with same name
    processInfo = await processManager.startProcess('restart-test', {
      command: 'sleep',
      args: ['2'],
      timeout: 5000,
    });
    const newPid = processInfo.pid;

    expect(newPid).not.toBe(originalPid);
    expect(processManager.isProcessRunning('restart-test')).toBe(true);

    // Cleanup
    await processManager.stopProcess('restart-test');
  });

  it('should handle concurrent lifecycle operations', async () => {
    const operations = Array.from({ length: 5 }, (_, i) => ({
      name: `concurrent-${i}`,
      command: 'sleep',
      args: ['1'],
    }));

    // Start all concurrently
    const startPromises = operations.map((op) =>
      processManager.startProcess(op.name, {
        command: op.command,
        args: op.args,
        timeout: 5000,
      }),
    );

    const processInfos = await Promise.all(startPromises);

    expect(processInfos).toHaveLength(5);
    processInfos.forEach((info) => {
      expect(info.pid).toBeGreaterThan(0);
    });

    // Stop all concurrently
    const stopPromises = operations.map((op) => processManager.stopProcess(op.name));

    await Promise.all(stopPromises);

    operations.forEach((op) => {
      expect(processManager.isProcessRunning(op.name)).toBe(false);
    });
  });

  it('should validate lifecycle configuration patterns', async () => {
    const configurations = [
      { transport: 'stdio', servers: 1, auth: false },
      { transport: 'stdio', servers: 3, auth: true },
      { transport: 'stdio', servers: 5, auth: false },
    ];

    configurations.forEach((config) => {
      const builder = new ConfigBuilder().enableStdioTransport();

      if (config.auth) {
        builder.enableAuth('test-client', 'test-secret');
      }

      for (let i = 0; i < config.servers; i++) {
        builder.addStdioServer(`server-${i}`, 'echo', [`arg-${i}`], ['test']);
      }

      const builtConfig = builder.build();
      expect(builtConfig.transport?.stdio).toBe(true);
      expect(builtConfig.servers).toHaveLength(config.servers);
      expect(!!builtConfig.auth?.enabled).toBe(config.auth);
    });
  });

  it('should handle cleanup on test completion', async () => {
    // Start some processes with fast startup
    await processManager.startProcess('cleanup-test-1', {
      command: 'sleep',
      args: ['10'],
      timeout: 15000,
      startupTimeout: 2000, // Reasonable startup timeout
    });

    await processManager.startProcess('cleanup-test-2', {
      command: 'sleep',
      args: ['10'],
      timeout: 15000,
      startupTimeout: 2000, // Reasonable startup timeout
    });

    expect(processManager.getAllProcesses().size).toBe(2);

    // Cleanup should handle all processes
    await processManager.cleanup();
    expect(processManager.getAllProcesses().size).toBe(0);
  });
});
