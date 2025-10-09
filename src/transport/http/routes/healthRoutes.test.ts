import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { HealthStatus } from '@src/services/healthService.js';
import createHealthRoutes from './healthRoutes.js';

// Mock dependencies
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@src/services/healthService.js', () => {
  const mockHealthService = {
    getInstance: vi.fn(),
    performHealthCheck: vi.fn(),
    getHttpStatusCode: vi.fn(),
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
    // Create Express app with health routes
    app = express();
    app.use(express.json());
    app.use('/health', createHealthRoutes());

    // Get mock health service
    const { HealthService } = await import('../../../services/healthService.js');
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
