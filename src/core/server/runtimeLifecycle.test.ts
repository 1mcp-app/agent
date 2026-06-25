import fs from 'fs';
import path from 'path';

import { getPidFilePath, ServerPidInfo, writePidFile } from '@src/core/server/pidFileManager.js';
import { discoverScopedRuntime } from '@src/core/server/runtimeLifecycle.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtimeLifecycle', () => {
  const testConfigDir = path.join(process.cwd(), '.tmp-test-lifecycle');
  const testPidFilePath = getPidFilePath(testConfigDir);

  const baseInfo = (overrides: Partial<ServerPidInfo> = {}): ServerPidInfo => ({
    pid: process.pid,
    url: 'http://localhost:3050/mcp',
    port: 3050,
    host: 'localhost',
    transport: 'http',
    startedAt: new Date().toISOString(),
    configDir: testConfigDir,
    ...overrides,
  });

  beforeEach(() => {
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testPidFilePath)) {
      fs.unlinkSync(testPidFilePath);
    }
    if (fs.existsSync(testConfigDir)) {
      fs.rmdirSync(testConfigDir);
    }
    vi.restoreAllMocks();
  });

  describe('discoverScopedRuntime', () => {
    it('reports not-running when no PID file exists', async () => {
      const result = await discoverScopedRuntime(testConfigDir, async () => true);
      expect(result.status).toBe('not-running');
      expect(result.info).toBeNull();
    });

    describe('tier 1: dead process', () => {
      it('deletes the stale PID file and reports not-running', async () => {
        writePidFile(testConfigDir, baseInfo({ pid: 99999999 }));
        expect(fs.existsSync(testPidFilePath)).toBe(true);

        const probe = vi.fn(async () => true);
        const result = await discoverScopedRuntime(testConfigDir, probe);

        expect(result.status).toBe('not-running');
        expect(result.info).toBeNull();
        // Dead process → PID file removed.
        expect(fs.existsSync(testPidFilePath)).toBe(false);
        // Readiness is never probed for a dead process.
        expect(probe).not.toHaveBeenCalled();
      });
    });

    describe('tier 2: alive but unreachable', () => {
      it('retains the PID file and reports not-usable', async () => {
        writePidFile(testConfigDir, baseInfo());
        expect(fs.existsSync(testPidFilePath)).toBe(true);

        const probe = vi.fn(async () => false);
        const result = await discoverScopedRuntime(testConfigDir, probe);

        expect(result.status).toBe('unreachable');
        expect(result.info).not.toBeNull();
        expect(result.info?.pid).toBe(process.pid);
        // Alive but unreachable → PID file MUST be retained (may be mid-startup).
        expect(fs.existsSync(testPidFilePath)).toBe(true);
        expect(probe).toHaveBeenCalledOnce();
      });
    });

    describe('alive and ready', () => {
      it('reports running and retains the PID file', async () => {
        writePidFile(testConfigDir, baseInfo({ logFile: '/tmp/server.log' }));

        const result = await discoverScopedRuntime(testConfigDir, async () => true);

        expect(result.status).toBe('running');
        expect(result.info?.pid).toBe(process.pid);
        expect(result.info?.logFile).toBe('/tmp/server.log');
        expect(fs.existsSync(testPidFilePath)).toBe(true);
      });
    });
  });
});
