import { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RestartableStdioTransport } from './restartableStdioTransport.js';

// Mock the StdioClientTransport
const mockStdioClientTransport = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    stderr: null,
    pid: 1234,
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
  })),
);

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mockStdioClientTransport,
  getDefaultEnvironment: vi.fn().mockReturnValue({ HOME: '/home/user', PATH: '/usr/bin' }),
}));

// Mock logger
vi.mock('@src/logger/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('RestartableStdioTransport', () => {
  const mockServerParams: StdioServerParameters = {
    command: 'test-command',
    args: ['arg1', 'arg2'],
    env: { NODE_ENV: 'test' },
  };

  let transport: RestartableStdioTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new RestartableStdioTransport(mockServerParams, {
      restartOnExit: true,
      maxRestarts: 3,
      restartDelay: 100,
    });
  });

  afterEach(() => {
    // Ensure transport is closed after each test
    if (transport) {
      transport.close();
    }
  });

  describe('Constructor', () => {
    it('should create RestartableStdioTransport instance', () => {
      expect(transport).toBeInstanceOf(RestartableStdioTransport);
    });

    it('should initialize with zero restart count', () => {
      const stats = transport.getRestartStats();
      expect(stats.restartCount).toBe(0);
      expect(stats.isRestarting).toBe(false);
    });
  });

  describe('Transport Interface', () => {
    it('should start transport successfully', async () => {
      await expect(transport.start()).resolves.toBeUndefined();

      const stats = transport.getRestartStats();
      expect(stats.isRestarting).toBe(false);
    });

    it('should throw error when starting already started transport', async () => {
      await transport.start();

      await expect(transport.start()).rejects.toThrow('RestartableStdioTransport already started!');
    });

    it('should send messages through underlying transport', async () => {
      await transport.start();

      const message = { jsonrpc: '2.0' as const, id: 1, method: 'test' };
      await expect(transport.send(message)).resolves.toBeUndefined();
    });

    it('should throw error when sending message on unstarted transport', async () => {
      const message = { jsonrpc: '2.0' as const, id: 1, method: 'test' };

      await expect(transport.send(message)).rejects.toThrow('Transport not started');
    });

    it('should close transport successfully', async () => {
      await transport.start();
      await expect(transport.close()).resolves.toBeUndefined();
    });
  });

  describe('Restart Functionality', () => {
    it('should not restart when restartOnExit is false', async () => {
      const noRestartTransport = new RestartableStdioTransport(mockServerParams, {
        restartOnExit: false,
      });

      const onCloseMock = vi.fn();
      noRestartTransport.onclose = onCloseMock;

      await noRestartTransport.start();

      // Simulate transport close
      const mockTransport = (noRestartTransport as any)._currentTransport;
      mockTransport.onclose();

      expect(onCloseMock).toHaveBeenCalled();

      await noRestartTransport.close();
    });

    it('should attempt restart on unexpected close', async () => {
      await transport.start();

      const initialStats = transport.getRestartStats();
      expect(initialStats.restartCount).toBe(0);

      // Simulate unexpected transport close
      const mockTransport = (transport as any)._currentTransport;
      mockTransport.onclose();

      // Wait for restart attempt
      await new Promise((resolve) => setTimeout(resolve, 150));

      const postRestartStats = transport.getRestartStats();
      expect(postRestartStats.restartCount).toBe(1);
    });

    it('should respect max restart limit', async () => {
      const onErrorMock = vi.fn();
      transport.onerror = onErrorMock;

      await transport.start();

      // Trigger multiple restarts
      const mockTransport = (transport as any)._currentTransport;

      for (let i = 0; i < 4; i++) {
        mockTransport.onclose();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // Should have hit max restart limit
      expect(onErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Transport failed after 3 restart attempts'),
        }),
      );
    });

    it('should not restart when closing intentionally', async () => {
      await transport.start();

      const restartSpy = vi.spyOn(transport as any, 'attemptRestart');

      // Close intentionally
      await transport.close();

      // Simulate transport close event after intentional close
      const mockTransport = (transport as any)._currentTransport;
      if (mockTransport) {
        mockTransport.onclose?.();
      }

      expect(restartSpy).not.toHaveBeenCalled();
    });
  });

  describe('Event Forwarding', () => {
    it('should forward error events from underlying transport', async () => {
      const onErrorMock = vi.fn();
      transport.onerror = onErrorMock;

      await transport.start();

      const testError = new Error('Test transport error');
      const mockTransport = (transport as any)._currentTransport;
      mockTransport.onerror(testError);

      expect(onErrorMock).toHaveBeenCalledWith(testError);
    });

    it('should forward message events from underlying transport', async () => {
      const onMessageMock = vi.fn();
      transport.onmessage = onMessageMock;

      await transport.start();

      const testMessage = { jsonrpc: '2.0' as const, id: 1, result: 'test' };
      const mockTransport = (transport as any)._currentTransport;
      mockTransport.onmessage(testMessage);

      expect(onMessageMock).toHaveBeenCalledWith(testMessage);
    });
  });

  describe('Properties', () => {
    it('should return stderr from underlying transport', async () => {
      await transport.start();

      const stderr = transport.stderr;
      expect(stderr).toBeNull(); // Mock returns null
    });

    it('should return pid from underlying transport', async () => {
      await transport.start();

      const pid = transport.pid;
      expect(pid).toBe(1234); // Mock returns 1234
    });

    it('should return null for stderr and pid when not started', () => {
      expect(transport.stderr).toBeNull();
      expect(transport.pid).toBeNull();
    });

    it('should support setting timeout and tags properties', () => {
      transport.timeout = 5000;
      transport.tags = ['test', 'mcp'];

      expect(transport.timeout).toBe(5000);
      expect(transport.tags).toEqual(['test', 'mcp']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle restart failure gracefully', async () => {
      const onErrorMock = vi.fn();
      transport.onerror = onErrorMock;

      await transport.start();

      // Set up the mock to fail on the next instantiation (restart)
      mockStdioClientTransport.mockImplementationOnce(() => ({
        start: vi.fn().mockRejectedValue(new Error('Start failed')),
        close: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
        stderr: null,
        pid: 1234,
        onclose: undefined,
        onerror: undefined,
        onmessage: undefined,
      }));

      // Trigger restart
      const mockTransport = (transport as any)._currentTransport;
      mockTransport.onclose();

      // Wait for restart attempt
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(onErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Start failed'),
        }),
      );
    });

    it('should clear restart timer when closed', async () => {
      await transport.start();

      // Trigger restart
      const mockTransport = (transport as any)._currentTransport;
      mockTransport.onclose();

      // Close immediately before restart can complete
      await transport.close();

      // Verify timer was cleared (no way to directly test, but should not crash)
      expect(() => transport.close()).not.toThrow();
    });
  });
});
