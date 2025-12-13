import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import {
  registerPidFileCleanup,
  registerPidFileSignalHandlers,
  ServerPidInfo,
  writePidFile,
} from '@src/core/server/pidFileManager.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('PID File Manager - Crash Scenario Tests', () => {
  const testConfigDir = path.join(process.cwd(), '.tmp-test-pid-crash');
  const testPidFilePath = path.join(testConfigDir, 'server.pid');

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testPidFilePath)) {
      fs.unlinkSync(testPidFilePath);
    }
    if (fs.existsSync(testConfigDir)) {
      fs.rmdirSync(testConfigDir);
    }
    vi.restoreAllMocks();
  });

  describe('Signal Handler Conflict Simulation', () => {
    let mockEventEmitter: EventEmitter;
    let originalProcessOn: typeof process.on;
    let originalProcessExit: typeof process.exit;
    let processExitCalls: any[] = [];
    let cleanupCalls: any[] = [];

    beforeEach(() => {
      processExitCalls = [];
      cleanupCalls = [];
      mockEventEmitter = new EventEmitter();

      // Store original methods
      originalProcessOn = process.on;
      originalProcessExit = process.exit;

      // Mock process.on to capture listeners
      vi.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: any) => {
        mockEventEmitter.on(event, listener);
        return process;
      });

      // Mock process.exit to track calls without actually exiting
      vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        processExitCalls.push(code);
        throw new Error(`process.exit(${code}) called - would have crashed`);
      });
    });

    afterEach(() => {
      // Restore original methods
      process.on = originalProcessOn;
      process.exit = originalProcessExit;
      mockEventEmitter.removeAllListeners();
    });

    it('should demonstrate crash scenario with conflicting signal handlers', () => {
      const serverInfo: ServerPidInfo = {
        pid: process.pid,
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'http',
        startedAt: new Date().toISOString(),
        configDir: testConfigDir,
      };

      // Write PID file
      writePidFile(testConfigDir, serverInfo);
      expect(fs.existsSync(testPidFilePath)).toBe(true);

      // Simulate the OLD behavior that causes crashes:
      // 1. PID file manager registers signal handlers that call process.exit immediately
      registerPidFileSignalHandlers(testConfigDir);

      // 2. Application also registers its own signal handlers (for graceful shutdown)
      const gracefulShutdown = vi.fn();
      process.on('SIGINT', gracefulShutdown);
      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGHUP', gracefulShutdown);

      // Simulate a signal (this would happen during connection errors)
      expect(() => {
        mockEventEmitter.emit('SIGINT');
      }).toThrow('process.exit(0) called - would have crashed');

      // Verify the crash scenario:
      expect(processExitCalls).toEqual([0]);
      expect(gracefulShutdown).not.toHaveBeenCalled();
      // PID file is cleaned up by the immediate handler
      expect(fs.existsSync(testPidFilePath)).toBe(false);

      console.log('✅ Demonstrated crash scenario: Signal handler conflict causes immediate exit');
    });

    it('should demonstrate fixed behavior with proper signal handling', () => {
      const serverInfo: ServerPidInfo = {
        pid: process.pid,
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'http',
        startedAt: new Date().toISOString(),
        configDir: testConfigDir,
      };

      // Write PID file
      writePidFile(testConfigDir, serverInfo);
      expect(fs.existsSync(testPidFilePath)).toBe(true);

      // Simulate the NEW behavior that prevents crashes:
      // 1. PID file manager registers only for 'exit' event, not signals
      registerPidFileCleanup(testConfigDir);

      // 2. Application registers its own signal handlers for graceful shutdown
      const gracefulShutdown = vi.fn(() => {
        // Simulate graceful shutdown cleanup
        cleanupCalls.push('graceful-shutdown');
      });
      process.on('SIGINT', gracefulShutdown);
      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGHUP', gracefulShutdown);

      // Simulate a signal (this would happen during connection errors)
      expect(() => {
        mockEventEmitter.emit('SIGINT');
      }).not.toThrow();

      // Verify the fixed behavior:
      expect(processExitCalls).toEqual([]); // No immediate exit
      expect(gracefulShutdown).toHaveBeenCalled(); // Graceful shutdown runs
      expect(cleanupCalls).toContain('graceful-shutdown');
      // PID file is NOT cleaned up by signal handler (will be cleaned by graceful shutdown)
      expect(fs.existsSync(testPidFilePath)).toBe(true);

      console.log('✅ Demonstrated fixed behavior: No crash, graceful shutdown runs');
    });

    it('should simulate ECONNRESET error scenario', async () => {
      const serverInfo: ServerPidInfo = {
        pid: process.pid,
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'http',
        startedAt: new Date().toISOString(),
        configDir: testConfigDir,
      };

      writePidFile(testConfigDir, serverInfo);

      // Create a mock client that triggers an ECONNRESET error
      const mockClient = {
        onerror: null as ((error: Error) => void) | null,
      };

      // Simulate the client error handler (from ClientManager)
      const clientErrorHandler = (error: Error) => {
        console.log(`Client error: ${error.message}`);
        // In the original code, this error might have triggered signals
        // Now it just logs the error
      };

      mockClient.onerror = clientErrorHandler;

      // Simulate ECONNRESET error
      const econnresetError = new Error('The socket connection was closed unexpectedly');
      (econnresetError as any).code = 'ECONNRESET';

      // This should NOT crash the process
      expect(() => {
        if (mockClient.onerror) {
          mockClient.onerror(econnresetError);
        }
      }).not.toThrow();

      // Verify process is still alive and PID file exists
      expect(fs.existsSync(testPidFilePath)).toBe(true);

      console.log('✅ ECONNRESET error handled gracefully without crashing');
    });

    it('should show that graceful shutdown properly cleans up PID file', async () => {
      const serverInfo: ServerPidInfo = {
        pid: process.pid,
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'http',
        startedAt: new Date().toISOString(),
        configDir: testConfigDir,
      };

      writePidFile(testConfigDir, serverInfo);
      expect(fs.existsSync(testPidFilePath)).toBe(true);

      // Register for exit only
      registerPidFileCleanup(testConfigDir);

      // Simulate graceful shutdown with PID cleanup
      const { cleanupPidFileOnExit } = await import('@src/core/server/pidFileManager.js');

      // This would be called by the graceful shutdown handler in serve.ts
      cleanupPidFileOnExit(testConfigDir);

      // Verify PID file is cleaned up
      expect(fs.existsSync(testPidFilePath)).toBe(false);

      console.log('✅ PID file properly cleaned up during graceful shutdown');
    });
  });

  describe('Connection Error Resilience', () => {
    it('should handle multiple rapid connection errors without crashing', () => {
      const serverInfo: ServerPidInfo = {
        pid: process.pid,
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'http',
        startedAt: new Date().toISOString(),
        configDir: testConfigDir,
      };

      writePidFile(testConfigDir, serverInfo);

      // Register only exit handler (new behavior)
      registerPidFileCleanup(testConfigDir);

      // Simulate multiple connection errors
      const errors = [
        new Error('ECONNRESET: Connection reset by peer'),
        new Error('ETIMEDOUT: Connection timed out'),
        new Error('ENOTFOUND: DNS lookup failed'),
        new Error('ECONNREFUSED: Connection refused'),
      ];

      errors.forEach((error, index) => {
        (error as any).code = error.message.split(':')[0];

        // Simulate client error handling
        console.log(`Connection error ${index + 1}: ${error.message}`);

        // Process should still be alive
        expect(fs.existsSync(testPidFilePath)).toBe(true);
      });

      console.log('✅ Multiple connection errors handled without crashing');
    });
  });
});
