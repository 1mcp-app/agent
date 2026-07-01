import fs from 'fs';
import path from 'path';

import { getPidFilePath, ServerPidInfo, writePidFile } from '@src/core/server/pidFileManager.js';
import { discoverScopedRuntime, probeLoadingSummary } from '@src/core/server/runtimeLifecycle.js';

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

    describe('unreadable PID file', () => {
      it('reports error instead of treating the scope as not-running', async () => {
        const originalReadFileSync = fs.readFileSync;
        const error = Object.assign(new Error('denied'), { code: 'EACCES' });
        vi.spyOn(fs, 'readFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, ...args: unknown[]) => {
          if (filePath === testPidFilePath) {
            throw error;
          }
          return originalReadFileSync(filePath, ...(args as []));
        }) as typeof fs.readFileSync);

        const result = await discoverScopedRuntime(testConfigDir, async () => true);

        expect(result.status).toBe('error');
        expect(result.info).toBeNull();
        expect(result.error).toContain('PID file present but unreadable');
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

  describe('probeLoadingSummary', () => {
    it('maps /health/mcp loading state into aggregate counts', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'X-Loading-Complete': 'true' }),
        json: async () => ({
          loading: { isComplete: true },
          summary: { total: 9, pending: 1, loading: 2, ready: 3, failed: 1, awaitingOAuth: 1, cancelled: 1 },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await probeLoadingSummary(baseInfo({ url: 'http://localhost:3050/mcp' }));

      expect(fetchMock).toHaveBeenCalledWith('http://localhost:3050/health/mcp', expect.any(Object));
      expect(result).toEqual({
        ready: 3,
        loading: 3,
        failed: 1,
        total: 9,
        isComplete: true,
      });
    });

    it('returns null when the loading endpoint cannot be reached', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not up yet')));

      await expect(probeLoadingSummary(baseInfo())).resolves.toBeNull();
    });

    it('returns null when the loading endpoint payload is malformed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            loading: { isComplete: 'true' },
            summary: { total: '9', pending: '1', loading: 2, ready: 3, failed: 1 },
          }),
        }),
      );

      await expect(probeLoadingSummary(baseInfo())).resolves.toBeNull();
    });
  });
});
