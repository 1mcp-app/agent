import { HealthStatus } from '@src/application/services/healthService.js';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import createHealthRoutes from './healthRoutes.js';

const mockRuntimeConnections = new Map<string, any>();

vi.mock('@src/core/client/clientManager.js', () => ({
  ClientManager: {
    current: {
      getClients: () => mockRuntimeConnections,
    },
  },
}));

// Mock dependencies
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

vi.mock('@src/application/services/healthService.js', () => {
  const mockHealthService = {
    getInstance: vi.fn(),
    performHealthCheck: vi.fn(),
    getHttpStatusCode: vi.fn(),
    serializeBackendSupervision: vi.fn((snapshots: Record<string, any>) =>
      Object.fromEntries(
        Object.entries(snapshots).map(([name, snapshot]) => [
          name,
          { ...snapshot, lastError: snapshot.lastError?.message ?? null },
        ]),
      ),
    ),
  };

  return {
    HealthService: {
      getInstance: () => mockHealthService,
    },
    HealthStatus: {
      HEALTHY: 'healthy',
      DEGRADED: 'degraded',
      UNHEALTHY: 'unhealthy',
    },
  };
});

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn(() => ({
      getRateLimitWindowMs: () => 300000, // 5 minutes
      getRateLimitMax: () => 200,
    })),
  },
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (req: any, res: any, next: any) => next()),
}));

describe('Health Routes', () => {
  let app: express.Application;
  let mockHealthService: any;

  beforeEach(async () => {
    mockRuntimeConnections.clear();
    // Create Express app with health routes
    app = express();
    app.use(express.json());
    app.use('/health', createHealthRoutes());

    // Get mock health service
    const { HealthService } = await import('../../../application/services/healthService.js');
    mockHealthService = HealthService.getInstance();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return healthy status with 200', async () => {
      const mockHealthData = {
        status: HealthStatus.HEALTHY,
        timestamp: '2025-01-30T12:00:00.000Z',
        version: '0.15.0',
        system: {
          uptime: 3600,
          memory: {
            used: 50.5,
            total: 100.0,
            percentage: 50.5,
          },
          process: {
            pid: 12345,
            nodeVersion: 'v20.0.0',
            platform: 'linux',
            arch: 'x64',
          },
        },
        servers: {
          total: 2,
          healthy: 2,
          unhealthy: 0,
          details: [
            {
              name: 'server1',
              status: 'connected',
              healthy: true,
              lastConnected: '2025-01-30T11:00:00.000Z',
            },
          ],
        },
        configuration: {
          loaded: true,
          serverCount: 1,
          authEnabled: false,
          transport: 'http',
        },
      };

      mockHealthService.performHealthCheck.mockResolvedValue(mockHealthData);
      mockHealthService.getHttpStatusCode.mockReturnValue(200);

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
      expect(response.headers['x-health-status']).toBe(HealthStatus.HEALTHY);
      expect(response.headers['x-service-version']).toBe('0.15.0');
      expect(response.headers['x-uptime-seconds']).toBe('3600');
      expect(response.body).toEqual(mockHealthData);
    });

    it('should return degraded status with 200', async () => {
      const mockHealthData = {
        status: HealthStatus.DEGRADED,
        timestamp: '2025-01-30T12:00:00.000Z',
        version: '0.15.0',
        system: {
          uptime: 3600,
          memory: { used: 50.5, total: 100.0, percentage: 50.5 },
          process: { pid: 12345, nodeVersion: 'v20.0.0', platform: 'linux', arch: 'x64' },
        },
        servers: {
          total: 2,
          healthy: 1,
          unhealthy: 1,
          details: [],
        },
        configuration: {
          loaded: true,
          serverCount: 2,
          authEnabled: false,
          transport: 'http',
        },
      };

      mockHealthService.performHealthCheck.mockResolvedValue(mockHealthData);
      mockHealthService.getHttpStatusCode.mockReturnValue(200);

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe(HealthStatus.DEGRADED);
    });

    it('should return unhealthy status with 503', async () => {
      const mockHealthData = {
        status: HealthStatus.UNHEALTHY,
        timestamp: '2025-01-30T12:00:00.000Z',
        version: '0.15.0',
        system: {
          uptime: 3600,
          memory: { used: 50.5, total: 100.0, percentage: 50.5 },
          process: { pid: 12345, nodeVersion: 'v20.0.0', platform: 'linux', arch: 'x64' },
        },
        servers: {
          total: 2,
          healthy: 0,
          unhealthy: 2,
          details: [],
        },
        configuration: {
          loaded: false,
          serverCount: 0,
          authEnabled: false,
          transport: 'http',
        },
      };

      mockHealthService.performHealthCheck.mockResolvedValue(mockHealthData);
      mockHealthService.getHttpStatusCode.mockReturnValue(503);

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe(HealthStatus.UNHEALTHY);
    });

    it('should handle health check errors with 500', async () => {
      const error = new Error('Health check failed');
      mockHealthService.performHealthCheck.mockRejectedValue(error);

      const response = await request(app).get('/health');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        status: HealthStatus.UNHEALTHY,
        timestamp: expect.any(String),
        error: 'Health check failed',
        message: 'Health check failed',
      });
    });

    it('should handle unknown errors with 500', async () => {
      const error = 'Unknown error';
      mockHealthService.performHealthCheck.mockRejectedValue(error);

      const response = await request(app).get('/health');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        status: HealthStatus.UNHEALTHY,
        timestamp: expect.any(String),
        error: 'Health check failed',
        message: 'Unknown error occurred',
      });
    });
  });

  describe('GET /health/live', () => {
    it('should return liveness status with 200', async () => {
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.body).toEqual({
        status: 'alive',
        timestamp: expect.any(String),
      });
    });

    it('should always return 200 even if health check would fail', async () => {
      // This should not affect liveness check
      mockHealthService.performHealthCheck.mockRejectedValue(new Error('Health check failed'));

      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('alive');
    });
  });

  describe('GET /health/ready', () => {
    it('should return ready status with 200 when configuration is loaded', async () => {
      const mockHealthData = {
        configuration: {
          loaded: true,
          serverCount: 1,
          authEnabled: false,
          transport: 'http',
        },
      };

      mockHealthService.performHealthCheck.mockResolvedValue(mockHealthData);

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.body).toEqual({
        status: 'ready',
        timestamp: expect.any(String),
        configuration: mockHealthData.configuration,
        backendSupervision: {},
      });
    });

    it('should return not ready status with 503 when configuration is not loaded', async () => {
      const mockHealthData = {
        configuration: {
          loaded: false,
          serverCount: 0,
          authEnabled: false,
          transport: 'http',
        },
      };

      mockHealthService.performHealthCheck.mockResolvedValue(mockHealthData);

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'not_ready',
        timestamp: expect.any(String),
        configuration: mockHealthData.configuration,
        backendSupervision: {},
      });
    });

    it.each(['restarting', 'crash-loop'])(
      'returns 503 while a backend is %s without affecting liveness',
      async (state) => {
        mockHealthService.performHealthCheck.mockResolvedValue({
          configuration: { loaded: true, serverCount: 1, authEnabled: false, transport: 'http' },
        });
        mockRuntimeConnections.set('worker', {
          supervision: {
            backendId: 'worker',
            state,
            attempt: 2,
            limit: 5,
            nextRetryAt: null,
            lastExit: { code: 1, signal: null, at: new Date().toISOString() },
            error: 'exited',
            currentPid: null,
          },
        });

        const readiness = await request(app).get('/health/ready');
        const liveness = await request(app).get('/health/live');

        expect(readiness.status).toBe(503);
        expect(readiness.body.backendSupervision.worker.state).toBe(state);
        expect(liveness.status).toBe(200);
      },
    );

    it('keeps readiness behavior while returning minimal aggregate supervision output', async () => {
      mockHealthService.performHealthCheck.mockResolvedValue({
        configuration: { loaded: true, serverCount: 0, authEnabled: false, transport: 'http' },
      });
      mockRuntimeConnections.set('private-worker', {
        supervision: {
          backendId: 'private-worker',
          state: 'crash-loop',
          attempt: 5,
          limit: 5,
          nextRetryAt: null,
          lastExit: { code: 1, signal: null, pid: 123, at: new Date() },
          lastError: new Error('token=secret /private/config.json'),
          currentPid: null,
        },
      });
      mockHealthService.serializeBackendSupervision.mockReturnValueOnce({
        total: 1,
        connected: 0,
        restarting: 0,
        crashLoop: 1,
        stopped: 0,
      });

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.backendSupervision).toEqual({
        total: 1,
        connected: 0,
        restarting: 0,
        crashLoop: 1,
        stopped: 0,
      });
      expect(JSON.stringify(response.body)).not.toContain('private-worker');
      expect(JSON.stringify(response.body)).not.toContain('secret');
      expect(mockHealthService.serializeBackendSupervision).toHaveBeenCalledWith({
        'private-worker': expect.objectContaining({ state: 'crash-loop' }),
      });
    });

    it('should handle readiness check errors with 503', async () => {
      const error = new Error('Readiness check failed');
      mockHealthService.performHealthCheck.mockRejectedValue(error);

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'not_ready',
        timestamp: expect.any(String),
        error: 'Readiness check failed',
      });
    });
  });

  describe('GET /health/mcp/:serverName', () => {
    it('groups operational facts for all instances of a template target', async () => {
      const loadingManager = {
        getStateTracker: () => ({ getServerState: vi.fn() }),
      } as any;
      const templateApp = express();
      templateApp.use('/health', createHealthRoutes(loadingManager));
      mockRuntimeConnections.set('worker:first', {
        supervision: {
          backendId: `template:worker:${'a'.repeat(64)}`,
          state: 'connected',
          attempt: 0,
          limit: 5,
          nextRetryAt: null,
          lastExit: null,
          lastError: null,
          currentPid: 101,
        },
      });
      mockRuntimeConnections.set('worker:second', {
        supervision: {
          backendId: `template:worker:${'b'.repeat(64)}`,
          state: 'crash-loop',
          attempt: 5,
          limit: 5,
          nextRetryAt: null,
          lastExit: { code: 1, signal: null, pid: 102, at: new Date() },
          lastError: new Error('failed'),
          currentPid: null,
        },
      });

      const response = await request(templateApp).get('/health/mcp/worker');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        name: 'worker',
        state: 'crash-loop',
        instances: [
          { state: 'connected', currentPid: 101 },
          { state: 'crash-loop', lastError: 'failed', currentPid: null },
        ],
      });
    });

    it('returns aggregate supervision for a template target at minimal detail', async () => {
      const loadingManager = {
        getStateTracker: () => ({ getServerState: vi.fn() }),
      } as any;
      const templateApp = express();
      templateApp.use('/health', createHealthRoutes(loadingManager));
      mockRuntimeConnections.set('worker:first', {
        supervision: {
          backendId: `template:worker:${'a'.repeat(64)}`,
          state: 'connected',
          attempt: 0,
          limit: 5,
          nextRetryAt: null,
          lastExit: null,
          lastError: null,
          currentPid: 101,
        },
      });
      mockHealthService.serializeBackendSupervision.mockReturnValueOnce({
        total: 1,
        connected: 1,
        restarting: 0,
        crashLoop: 0,
        stopped: 0,
      });

      const response = await request(templateApp).get('/health/mcp/worker');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        name: 'worker',
        state: 'connected',
        backendSupervision: { total: 1, connected: 1 },
      });
      expect(response.body.instances).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('template:worker');
      expect(JSON.stringify(response.body)).not.toContain('101');
    });
  });

  describe('Rate limiting', () => {
    it('should apply rate limiting to health endpoints', async () => {
      // This test verifies that rate limiting middleware is applied
      // The actual rate limiting behavior is mocked, but we verify the setup
      const response = await request(app).get('/health');

      // Should still work (since we're mocking the rate limiter to allow requests)
      expect(response.status).not.toBe(429);
    });
  });
});
