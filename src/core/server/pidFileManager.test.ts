import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import {
  cleanupPidFile,
  cleanupPidFileIfMatches,
  cleanupPidFileOnExit,
  getPidFilePath,
  isProcessAlive,
  PidFileReadError,
  readPidFile,
  registerPidFileCleanup,
  registerPidFileSignalHandlers,
  ServerPidInfo,
  writePidFile,
} from '@src/core/server/pidFileManager.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('pidFileManager', () => {
  const testConfigDir = path.join(process.cwd(), '.tmp-test-pid');
  const testPidFilePath = getPidFilePath(testConfigDir);

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up test directory
    if (fs.existsSync(testPidFilePath)) {
      fs.unlinkSync(testPidFilePath);
    }
    if (fs.existsSync(testConfigDir)) {
      fs.rmdirSync(testConfigDir);
    }
  });

  describe('getPidFilePath', () => {
    it('should return correct PID file path', () => {
      const pidPath = getPidFilePath('/test/config');
      expect(pidPath).toBe(path.join('/test/config', 'server.pid'));
    });
  });

  describe('isProcessAlive', () => {
    it('should return true for current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('should return false for non-existent process', () => {
      // Use a very high PID that is unlikely to exist
      expect(isProcessAlive(99999999)).toBe(false);
    });
  });

  describe('writePidFile', () => {
    it('should write PID file with correct format', () => {
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

      const content = fs.readFileSync(testPidFilePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.pid).toBe(process.pid);
      expect(parsed.url).toBe('http://localhost:3050/mcp');
      expect(parsed.port).toBe(3050);
      expect(parsed.host).toBe('localhost');
      expect(parsed.transport).toBe('http');
    });

    it('should create config directory if it does not exist', () => {
      const newConfigDir = path.join(testConfigDir, 'nested');
      const serverInfo: ServerPidInfo = {
        pid: process.pid,
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'http',
        startedAt: new Date().toISOString(),
        configDir: newConfigDir,
      };

      writePidFile(newConfigDir, serverInfo);

      expect(fs.existsSync(newConfigDir)).toBe(true);
      expect(fs.existsSync(getPidFilePath(newConfigDir))).toBe(true);

      // Cleanup
      fs.unlinkSync(getPidFilePath(newConfigDir));
      fs.rmdirSync(newConfigDir);
    });
  });

  describe('readPidFile', () => {
    it('should read valid PID file with alive process', () => {
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

      const result = readPidFile(testConfigDir);

      expect(result).not.toBeNull();
      expect(result?.pid).toBe(process.pid);
      expect(result?.url).toBe('http://localhost:3050/mcp');
    });

    it('should return null for non-existent PID file', () => {
      const result = readPidFile(testConfigDir);
      expect(result).toBeNull();
    });

    it('should throw for unreadable PID files', () => {
      const originalReadFileSync = fs.readFileSync;
      const error = Object.assign(new Error('denied'), { code: 'EACCES' });
      vi.spyOn(fs, 'readFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, ...args: unknown[]) => {
        if (filePath === testPidFilePath) {
          throw error;
        }
        return originalReadFileSync(filePath, ...(args as []));
      }) as typeof fs.readFileSync);

      expect(() => readPidFile(testConfigDir)).toThrow(PidFileReadError);
    });

    it('should read the record even for a dead process (pure reader; liveness is the lifecycle module concern)', () => {
      const serverInfo: ServerPidInfo = {
        pid: 99999999, // Non-existent process
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'http',
        startedAt: new Date().toISOString(),
        configDir: testConfigDir,
      };

      writePidFile(testConfigDir, serverInfo);

      const result = readPidFile(testConfigDir);
      expect(result).not.toBeNull();
      expect(result?.pid).toBe(99999999);
      // readPidFile must NOT delete the file; deletion is owned by runtimeLifecycle
      expect(fs.existsSync(testPidFilePath)).toBe(true);
    });

    it('should round-trip the optional logFile field', () => {
      const serverInfo: ServerPidInfo = {
        pid: process.pid,
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'http',
        startedAt: new Date().toISOString(),
        configDir: testConfigDir,
        logFile: path.join(testConfigDir, 'logs', 'server.log'),
      };

      writePidFile(testConfigDir, serverInfo);

      const result = readPidFile(testConfigDir);
      expect(result?.logFile).toBe(path.join(testConfigDir, 'logs', 'server.log'));
    });

    it('should return null for invalid JSON', () => {
      fs.writeFileSync(testPidFilePath, 'invalid json', 'utf-8');

      const result = readPidFile(testConfigDir);
      expect(result).toBeNull();
    });

    it('should return null for missing required fields', () => {
      fs.writeFileSync(testPidFilePath, JSON.stringify({ pid: process.pid }), 'utf-8');

      const result = readPidFile(testConfigDir);
      expect(result).toBeNull();
    });

    it('should reject a non-positive PID (guards against process-group signals)', () => {
      // A negative PID would make process.kill() signal an entire process group.
      const malformed = {
        pid: -1,
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'http',
        startedAt: '2026-06-26T00:00:00.000Z',
        configDir: testConfigDir,
      };
      fs.writeFileSync(testPidFilePath, JSON.stringify(malformed), 'utf-8');

      expect(readPidFile(testConfigDir)).toBeNull();
    });

    it('should reject wrong field types and out-of-range ports', () => {
      const malformed = {
        pid: '123',
        url: 'http://localhost:3050/mcp',
        port: 70000,
        host: 'localhost',
        transport: 'http',
        startedAt: '2026-06-26T00:00:00.000Z',
        configDir: testConfigDir,
      };
      fs.writeFileSync(testPidFilePath, JSON.stringify(malformed), 'utf-8');

      expect(readPidFile(testConfigDir)).toBeNull();
    });

    it('should reject a non-http transport', () => {
      const malformed = {
        pid: process.pid,
        url: 'http://localhost:3050/mcp',
        port: 3050,
        host: 'localhost',
        transport: 'stdio',
        startedAt: '2026-06-26T00:00:00.000Z',
        configDir: testConfigDir,
      };
      fs.writeFileSync(testPidFilePath, JSON.stringify(malformed), 'utf-8');

      expect(readPidFile(testConfigDir)).toBeNull();
    });
  });

  describe('cleanupPidFile', () => {
    it('should delete PID file if it exists', () => {
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

      expect(cleanupPidFile(testConfigDir)).toBe(true);
      expect(fs.existsSync(testPidFilePath)).toBe(false);
    });

    it('should not throw error if PID file does not exist', () => {
      expect(() => cleanupPidFile(testConfigDir)).not.toThrow();
      expect(cleanupPidFile(testConfigDir)).toBe(true);
    });

    it('should treat ENOENT during unlink as successful cleanup', () => {
      vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      });

      expect(cleanupPidFile(testConfigDir)).toBe(true);
    });
  });

  describe('cleanupPidFileIfMatches', () => {
    const infoWithPid = (pid: number): ServerPidInfo => ({
      pid,
      url: 'http://localhost:3050/mcp',
      port: 3050,
      host: 'localhost',
      transport: 'http',
      startedAt: '2026-06-26T00:00:00.000Z',
      configDir: testConfigDir,
    });

    it('should delete the PID file when it still records the expected PID', () => {
      writePidFile(testConfigDir, infoWithPid(process.pid));

      expect(cleanupPidFileIfMatches(testConfigDir, process.pid)).toBe(true);
      expect(fs.existsSync(testPidFilePath)).toBe(false);
    });

    it('should NOT delete a PID file that a newer runtime replaced', () => {
      // Simulate a different runtime owning the scope now (different PID).
      writePidFile(testConfigDir, infoWithPid(process.pid));

      // Caller expected an older/dead PID; the live file must be left intact.
      expect(cleanupPidFileIfMatches(testConfigDir, 99999998)).toBe(true);
      expect(fs.existsSync(testPidFilePath)).toBe(true);
      expect(readPidFile(testConfigDir)?.pid).toBe(process.pid);
    });

    it('should be a no-op when no PID file exists', () => {
      expect(cleanupPidFileIfMatches(testConfigDir, process.pid)).toBe(true);
    });
  });

  describe('cleanupPidFileOnExit', () => {
    it('should delete PID file when called', () => {
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

      cleanupPidFileOnExit(testConfigDir);
      expect(fs.existsSync(testPidFilePath)).toBe(false);
    });
  });

  describe('registerPidFileCleanup', () => {
    // Store original process methods to restore later
    let originalProcessOn: typeof process.on;
    let originalProcessListeners: typeof process.listeners;

    beforeEach(() => {
      // Mock process methods
      originalProcessOn = process.on;
      originalProcessListeners = process.listeners;
      vi.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: () => void) => {
        // For 'exit' event, call the listener immediately to test it
        if (event === 'exit') {
          listener();
        }
        return process;
      });
      vi.spyOn(process, 'listeners').mockReturnValue([]);
    });

    afterEach(() => {
      // Restore original process methods
      process.on = originalProcessOn;
      process.listeners = originalProcessListeners;
      vi.restoreAllMocks();
    });

    it('should register only for exit event, not signal events', () => {
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

      // This should only register for 'exit' event
      registerPidFileCleanup(testConfigDir);

      // Verify the PID file is cleaned up (exit handler was called)
      expect(fs.existsSync(testPidFilePath)).toBe(false);

      // Verify only 'exit' event was registered
      expect(process.on).toHaveBeenCalledWith('exit', expect.any(Function));
      // Should NOT have registered for signal events
      expect(process.on).not.toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(process.on).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(process.on).not.toHaveBeenCalledWith('SIGHUP', expect.any(Function));
    });
  });

  describe('registerPidFileSignalHandlers', () => {
    // Store original process methods to restore later
    let originalProcessOn: typeof process.on;
    let originalProcessExit: typeof process.exit;
    const mockEventEmitter = new EventEmitter();

    beforeEach(() => {
      // Mock process methods
      originalProcessOn = process.on;
      originalProcessExit = process.exit;
      vi.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: () => void) => {
        // Store listeners for later testing
        mockEventEmitter.on(event, listener);
        return process;
      });
      vi.spyOn(process, 'exit').mockImplementation(() => {
        // Don't actually exit in tests
        return undefined as never;
      });
    });

    afterEach(() => {
      // Restore original process methods
      process.on = originalProcessOn;
      process.exit = originalProcessExit;
      mockEventEmitter.removeAllListeners();
      vi.restoreAllMocks();
    });

    it('should register for all signal events and call process.exit', () => {
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

      // Register signal handlers
      registerPidFileSignalHandlers(testConfigDir);

      // Verify all signal events were registered
      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('SIGHUP', expect.any(Function));

      // Test SIGINT
      mockEventEmitter.emit('SIGINT');
      expect(fs.existsSync(testPidFilePath)).toBe(false);
      expect(process.exit).toHaveBeenCalledWith(0);

      // Recreate file for next test
      writePidFile(testConfigDir, serverInfo);

      // Test SIGTERM
      mockEventEmitter.emit('SIGTERM');
      expect(fs.existsSync(testPidFilePath)).toBe(false);
      expect(process.exit).toHaveBeenCalledWith(0);

      // Recreate file for next test
      writePidFile(testConfigDir, serverInfo);

      // Test SIGHUP
      mockEventEmitter.emit('SIGHUP');
      expect(fs.existsSync(testPidFilePath)).toBe(false);
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('Signal Handler Conflict Prevention', () => {
    let mockProcessExit: any;

    beforeEach(() => {
      // Track whether process.exit has been called
      mockProcessExit = vi.fn();

      // Mock process.exit to prevent actual exit
      vi.stubGlobal('process', {
        ...process,
        exit: mockProcessExit,
        on: vi.fn(),
        removeListener: vi.fn(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should NOT call process.exit when registerPidFileCleanup is used', () => {
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

      // Register only cleanup handler (no signal handlers)
      registerPidFileCleanup(testConfigDir);

      // Verify process.exit was NOT called
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('should call process.exit when registerPidFileSignalHandlers is used', () => {
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

      // Register signal handlers
      registerPidFileSignalHandlers(testConfigDir);

      // Get the registered listeners and simulate SIGINT
      const calls = (process.on as any).mock.calls;
      const sigintListener = calls.find((call: any) => call[0] === 'SIGINT')?.[1];

      if (sigintListener) {
        sigintListener();
      }

      // Verify process.exit WAS called
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });
  });
});
