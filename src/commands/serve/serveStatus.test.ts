import fs from 'fs';
import path from 'path';

import {
  formatRuntimeStatusReport,
  getRuntimeStatusReport,
  STATUS_EXIT_CODES,
} from '@src/commands/serve/serveStatus.js';
import { getPidFilePath, ServerPidInfo, writePidFile } from '@src/core/server/pidFileManager.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the (hoisted) vi.mock factory below can reference it safely.
const { probeReadinessMock } = vi.hoisted(() => ({ probeReadinessMock: vi.fn() }));

vi.mock('@src/core/server/runtimeLifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/core/server/runtimeLifecycle.js')>();
  return {
    ...actual,
    // Force discovery to use our controllable readiness probe instead of HTTP.
    discoverScopedRuntime: (configDir: string) => actual.discoverScopedRuntime(configDir, probeReadinessMock),
  };
});

describe('serveStatus', () => {
  const testConfigDir = path.join(process.cwd(), '.tmp-test-status');
  const testPidFilePath = getPidFilePath(testConfigDir);

  const baseInfo = (overrides: Partial<ServerPidInfo> = {}): ServerPidInfo => ({
    pid: process.pid,
    url: 'http://localhost:3050/mcp',
    port: 3050,
    host: 'localhost',
    transport: 'http',
    startedAt: '2026-06-26T00:00:00.000Z',
    configDir: testConfigDir,
    ...overrides,
  });

  beforeEach(() => {
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
    probeReadinessMock.mockReset();
  });

  afterEach(() => {
    if (fs.existsSync(testPidFilePath)) {
      fs.unlinkSync(testPidFilePath);
    }
    if (fs.existsSync(testConfigDir)) {
      fs.rmdirSync(testConfigDir);
    }
  });

  describe('getRuntimeStatusReport', () => {
    it('reports running with full details when alive and ready', async () => {
      writePidFile(testConfigDir, baseInfo({ logFile: '/tmp/server.log' }));
      probeReadinessMock.mockResolvedValue(true);

      const report = await getRuntimeStatusReport(testConfigDir);

      expect(report.status).toBe('running');
      expect(report.info?.pid).toBe(process.pid);
      expect(report.info?.logFile).toBe('/tmp/server.log');
      expect(STATUS_EXIT_CODES[report.status]).toBe(0);

      const text = formatRuntimeStatusReport(report);
      expect(text).toContain('running (ready)');
      expect(text).toContain(`PID: ${process.pid}`);
      expect(text).toContain('URL: http://localhost:3050/mcp');
      expect(text).toContain('Started: 2026-06-26T00:00:00.000Z');
      expect(text).toContain('Log file: /tmp/server.log');
      expect(text).toContain('Readiness (/health/ready): ready');
    });

    it('distinguishes alive-but-not-ready from running', async () => {
      writePidFile(testConfigDir, baseInfo());
      probeReadinessMock.mockResolvedValue(false);

      const report = await getRuntimeStatusReport(testConfigDir);

      expect(report.status).toBe('unreachable');
      expect(report.info?.pid).toBe(process.pid);
      expect(STATUS_EXIT_CODES[report.status]).toBe(4);
      // PID file is retained for an alive-but-not-ready runtime.
      expect(fs.existsSync(testPidFilePath)).toBe(true);

      const text = formatRuntimeStatusReport(report);
      expect(text).toContain('starting (not ready)');
      expect(text).toContain('Readiness (/health/ready): not ready');
    });

    it('reports not-running and removes a stale dead-process PID file', async () => {
      writePidFile(testConfigDir, baseInfo({ pid: 99999999 }));
      probeReadinessMock.mockResolvedValue(true);

      const report = await getRuntimeStatusReport(testConfigDir);

      expect(report.status).toBe('not-running');
      expect(report.info).toBeNull();
      expect(STATUS_EXIT_CODES[report.status]).toBe(3);
      // Dead process → stale PID file deleted.
      expect(fs.existsSync(testPidFilePath)).toBe(false);
      // Readiness is not probed for a dead process.
      expect(probeReadinessMock).not.toHaveBeenCalled();

      expect(formatRuntimeStatusReport(report)).toContain('Status: not running');
    });

    it('reports not-running for an empty scope', async () => {
      const report = await getRuntimeStatusReport(testConfigDir);
      expect(report.status).toBe('not-running');
      expect(report.info).toBeNull();
    });
  });
});
