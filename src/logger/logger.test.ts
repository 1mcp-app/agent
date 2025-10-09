import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureLogger } from './logger.js';
import logger from './logger.js';

describe('logger configuration', () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalOneMcpLogLevel = process.env.ONE_MCP_LOG_LEVEL;
  let tempLogFile: string;

  beforeEach(async () => {
    // Clear environment variables
    delete process.env.LOG_LEVEL;
    delete process.env.ONE_MCP_LOG_LEVEL;

    // Create temp file for log file tests
    tempLogFile = path.join(tmpdir(), `test-log-${Date.now()}.log`);
  });

  afterEach(async () => {
    // Restore original environment variables
    if (originalLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalLogLevel;
    }
    if (originalOneMcpLogLevel !== undefined) {
      process.env.ONE_MCP_LOG_LEVEL = originalOneMcpLogLevel;
    }

    // Clean up temp log file
    try {
      await fs.unlink(tempLogFile);
    } catch {
      // Ignore if file doesn't exist
    }

    vi.clearAllMocks();
  });

  describe('configureLogger', () => {
    it('should use CLI log level when provided', () => {
      const mockClear = vi.spyOn(logger, 'clear');
      const mockAdd = vi.spyOn(logger, 'add');

      configureLogger({
        logLevel: 'debug',
        transport: 'http',
      });

      expect(logger.level).toBe('debug');
      expect(mockClear).toHaveBeenCalled();
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
        }),
      );
    });

    it('should prefer ONE_MCP_LOG_LEVEL over LOG_LEVEL', () => {
      process.env.ONE_MCP_LOG_LEVEL = 'warn';
      process.env.LOG_LEVEL = 'debug';

      const mockClear = vi.spyOn(logger, 'clear');

      configureLogger({
        transport: 'http',
      });

      expect(logger.level).toBe('warn');
      expect(mockClear).toHaveBeenCalled();
    });

    it('should fallback to LOG_LEVEL with deprecation warning', () => {
      process.env.LOG_LEVEL = 'error';

      const mockWarn = vi.spyOn(logger, 'warn');
      const mockClear = vi.spyOn(logger, 'clear');

      configureLogger({
        transport: 'http',
      });

      expect(logger.level).toBe('error');
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('LOG_LEVEL environment variable is deprecated'));
      expect(mockClear).toHaveBeenCalled();
    });

    it('should default to info level when no log level is specified', () => {
      const mockClear = vi.spyOn(logger, 'clear');

      configureLogger({
        transport: 'http',
      });

      expect(logger.level).toBe('info');
      expect(mockClear).toHaveBeenCalled();
    });

    it('should configure file transport when log-file is specified', () => {
      const mockClear = vi.spyOn(logger, 'clear');
      const mockAdd = vi.spyOn(logger, 'add');

      configureLogger({
        logLevel: 'debug',
        logFile: tempLogFile,
        transport: 'http',
      });

      expect(mockClear).toHaveBeenCalled();
      expect(mockAdd).toHaveBeenCalledWith(expect.any(Object));
      expect(logger.level).toBe('debug');
    });

    it('should only add file transport for stdio mode with log-file', () => {
      const mockClear = vi.spyOn(logger, 'clear');
      const mockAdd = vi.spyOn(logger, 'add');

      configureLogger({
        logLevel: 'info',
        logFile: tempLogFile,
        transport: 'stdio',
      });

      expect(mockClear).toHaveBeenCalled();
      expect(mockAdd).toHaveBeenCalledTimes(1); // File only
      expect(logger.level).toBe('info');
    });

    it('should add both console and file transport for non-stdio mode with log-file', () => {
      const mockClear = vi.spyOn(logger, 'clear');
      const mockAdd = vi.spyOn(logger, 'add');

      configureLogger({
        logLevel: 'info',
        logFile: tempLogFile,
        transport: 'http',
      });

      expect(mockClear).toHaveBeenCalled();
      expect(mockAdd).toHaveBeenCalledTimes(2); // File + Console
      expect(logger.level).toBe('info');
    });

    it('should convert MCP log levels to Winston log levels correctly', () => {
      const testCases = [
        { mcp: 'debug', winston: 'debug' },
        { mcp: 'info', winston: 'info' },
        { mcp: 'notice', winston: 'info' },
        { mcp: 'warn', winston: 'warn' }, // Support both 'warn' and 'warning'
        { mcp: 'warning', winston: 'warn' },
        { mcp: 'error', winston: 'error' },
        { mcp: 'critical', winston: 'error' },
        { mcp: 'unknown', winston: 'info' }, // fallback
      ];

      testCases.forEach(({ mcp, winston: expectedWinston }) => {
        const mockClear = vi.spyOn(logger, 'clear');

        configureLogger({
          logLevel: mcp,
          transport: 'http',
        });

        expect(logger.level).toBe(expectedWinston);
        mockClear.mockRestore();
      });
    });
  });

  describe('environment variable priority', () => {
    it('should prefer CLI log level over environment variables', () => {
      process.env.ONE_MCP_LOG_LEVEL = 'warn';
      process.env.LOG_LEVEL = 'error';

      configureLogger({
        logLevel: 'debug', // CLI should win
        transport: 'http',
      });

      expect(logger.level).toBe('debug');
    });

    it('should prefer ONE_MCP_LOG_LEVEL over LOG_LEVEL', () => {
      process.env.ONE_MCP_LOG_LEVEL = 'warn';
      process.env.LOG_LEVEL = 'error';

      configureLogger({
        transport: 'http',
      });

      expect(logger.level).toBe('warn');
    });

    it('should show deprecation warning for LOG_LEVEL', () => {
      const mockWarn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      process.env.LOG_LEVEL = 'error';

      configureLogger({
        transport: 'http',
      });

      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('LOG_LEVEL environment variable is deprecated'));
      mockWarn.mockRestore();
    });
  });

  describe('MCP to Winston level conversion', () => {
    it('should convert MCP log levels to Winston log levels correctly', () => {
      const testCases = [
        { mcp: 'debug', winston: 'debug' },
        { mcp: 'info', winston: 'info' },
        { mcp: 'notice', winston: 'info' },
        { mcp: 'warn', winston: 'warn' }, // Support both 'warn' and 'warning'
        { mcp: 'warning', winston: 'warn' },
        { mcp: 'error', winston: 'error' },
        { mcp: 'critical', winston: 'error' },
        { mcp: 'unknown', winston: 'info' }, // fallback
      ];

      testCases.forEach(({ mcp, winston: expectedWinston }) => {
        configureLogger({
          logLevel: mcp,
          transport: 'http',
        });

        expect(logger.level).toBe(expectedWinston);
      });
    });
  });
});
