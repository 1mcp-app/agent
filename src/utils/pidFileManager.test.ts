import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  writePidFile,
  readPidFile,
  cleanupPidFile,
  isProcessAlive,
  getPidFilePath,
  ServerPidInfo,
} from './pidFileManager.js';

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

    it('should return null for dead process', () => {
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
      expect(result).toBeNull();
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

      cleanupPidFile(testConfigDir);
      expect(fs.existsSync(testPidFilePath)).toBe(false);
    });

    it('should not throw error if PID file does not exist', () => {
      expect(() => cleanupPidFile(testConfigDir)).not.toThrow();
    });
  });
});
