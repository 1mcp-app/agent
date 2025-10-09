import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseEnvArray, substituteEnvVars, substituteEnvVarsInConfig, processEnvironment } from './envProcessor.js';

// Mock getDefaultEnvironment to avoid SDK dependency in tests
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  getDefaultEnvironment: vi.fn().mockReturnValue({
    HOME: '/home/user',
    PATH: '/usr/bin',
  }),
}));

describe('EnvProcessor', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env for each test
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('parseEnvArray', () => {
    it('should parse key=value format', () => {
      const result = parseEnvArray(['NODE_ENV=production', 'DEBUG=true']);
      expect(result).toEqual({
        NODE_ENV: 'production',
        DEBUG: 'true',
      });
    });

    it('should handle inheritance for keys without equals', () => {
      process.env.EXISTING_VAR = 'test-value';
      process.env.ANOTHER_VAR = 'another-value';

      const result = parseEnvArray(['EXISTING_VAR', 'ANOTHER_VAR', 'NON_EXISTENT']);
      expect(result).toEqual({
        EXISTING_VAR: 'test-value',
        ANOTHER_VAR: 'another-value',
        // NON_EXISTENT should not be present since it doesn't exist
      });
    });

    it('should handle mixed format', () => {
      process.env.PATH = '/usr/bin';

      const result = parseEnvArray(['PATH', 'NODE_ENV=production']);
      expect(result).toEqual({
        PATH: '/usr/bin',
        NODE_ENV: 'production',
      });
    });

    it('should handle empty values', () => {
      const result = parseEnvArray(['EMPTY=', 'NORMAL=value']);
      expect(result).toEqual({
        EMPTY: '',
        NORMAL: 'value',
      });
    });
  });

  describe('substituteEnvVars', () => {
    it('should substitute single environment variable', () => {
      process.env.API_KEY = 'secret-key';

      const result = substituteEnvVars('${API_KEY}');
      expect(result).toBe('secret-key');
    });

    it('should substitute multiple environment variables', () => {
      process.env.HOST = 'localhost';
      process.env.PORT = '3000';

      const result = substituteEnvVars('http://${HOST}:${PORT}/api');
      expect(result).toBe('http://localhost:3000/api');
    });

    it('should handle missing environment variables', () => {
      const result = substituteEnvVars('${MISSING_VAR}');
      expect(result).toBe('${MISSING_VAR}'); // Should keep placeholder
    });

    it('should handle whitespace in variable names', () => {
      process.env.SPACED_VAR = 'value';

      const result = substituteEnvVars('${ SPACED_VAR }');
      expect(result).toBe('value');
    });

    it('should not substitute malformed patterns', () => {
      const result = substituteEnvVars('${INCOMPLETE');
      expect(result).toBe('${INCOMPLETE');
    });
  });

  describe('substituteEnvVarsInConfig', () => {
    it('should substitute in string values', () => {
      process.env.DB_HOST = 'localhost';

      const config = {
        database: {
          host: '${DB_HOST}',
          port: 5432,
        },
      };

      const result = substituteEnvVarsInConfig(config);
      expect(result).toEqual({
        database: {
          host: 'localhost',
          port: 5432,
        },
      });
    });

    it('should handle arrays with substitution', () => {
      process.env.CMD = 'node';
      process.env.ARG = 'server.js';

      const config = {
        command: '${CMD}',
        args: ['${ARG}', '--port', '3000'],
      };

      const result = substituteEnvVarsInConfig(config);
      expect(result).toEqual({
        command: 'node',
        args: ['server.js', '--port', '3000'],
      });
    });

    it('should preserve non-string values', () => {
      const config = {
        enabled: true,
        timeout: 5000,
        data: null,
        nested: {
          flag: false,
        },
      };

      const result = substituteEnvVarsInConfig(config);
      expect(result).toEqual(config);
    });
  });

  describe('processEnvironment', () => {
    beforeEach(() => {
      // Set up a clean test environment
      process.env = {
        HOME: '/home/user',
        PATH: '/usr/bin',
        NODE_ENV: 'test',
        DEBUG: 'true',
        SENSITIVE_DATA: 'secret',
        CUSTOM_VAR: 'custom-value',
      };
    });

    it('should process environment with SDK defaults only', () => {
      const result = processEnvironment({});

      expect(result.processedEnv).toHaveProperty('HOME');
      expect(result.processedEnv).toHaveProperty('PATH');
      expect(result.sources.sdkDefaults).toContain('HOME');
      expect(result.sources.sdkDefaults).toContain('PATH');
      expect(result.sources.inherited).toHaveLength(0);
      expect(result.sources.custom).toHaveLength(0);
    });

    it('should inherit parent environment when enabled', () => {
      const result = processEnvironment({
        inheritParentEnv: true,
      });

      expect(result.processedEnv).toHaveProperty('NODE_ENV', 'test');
      expect(result.processedEnv).toHaveProperty('DEBUG', 'true');
      expect(result.sources.inherited.length).toBeGreaterThan(0);
    });

    it('should apply environment filters', () => {
      const result = processEnvironment({
        inheritParentEnv: true,
        envFilter: ['NODE_*', 'DEBUG', '!SENSITIVE_*'],
      });

      expect(result.processedEnv).toHaveProperty('NODE_ENV', 'test');
      expect(result.processedEnv).toHaveProperty('DEBUG', 'true');
      expect(result.processedEnv).not.toHaveProperty('SENSITIVE_DATA');
      expect(result.sources.filtered).toContain('SENSITIVE_DATA');
    });

    it('should handle custom environment variables', () => {
      process.env.EXTERNAL_API = 'https://api.example.com';

      const result = processEnvironment({
        env: {
          API_KEY: 'test-key',
          ENDPOINT: '${EXTERNAL_API}/v1',
        },
      });

      expect(result.processedEnv).toHaveProperty('API_KEY', 'test-key');
      expect(result.processedEnv).toHaveProperty('ENDPOINT', 'https://api.example.com/v1');
      expect(result.sources.custom).toEqual(['API_KEY', 'ENDPOINT']);
    });

    it('should handle array format environment variables', () => {
      process.env.EXISTING_VAR = 'existing-value';

      const result = processEnvironment({
        env: ['EXISTING_VAR', 'NEW_VAR=new-value'],
      });

      expect(result.processedEnv).toHaveProperty('EXISTING_VAR', 'existing-value');
      expect(result.processedEnv).toHaveProperty('NEW_VAR', 'new-value');
      expect(result.sources.custom).toEqual(['EXISTING_VAR', 'NEW_VAR']);
    });

    it('should override inherited variables with custom ones', () => {
      const result = processEnvironment({
        inheritParentEnv: true,
        env: {
          NODE_ENV: 'overridden',
        },
      });

      expect(result.processedEnv).toHaveProperty('NODE_ENV', 'overridden');
    });

    it('should handle complex filtering scenarios', () => {
      process.env = {
        ...process.env,
        NODE_VERSION: '18.0.0',
        NODE_OPTIONS: '--max-old-space-size=4096',
        NPM_CONFIG_PREFIX: '/usr/local',
        BASH_FUNC_test: '() { echo test; }',
        SECRET_KEY: 'very-secret',
        PUBLIC_VAR: 'public-value',
      };

      const result = processEnvironment({
        inheritParentEnv: true,
        envFilter: [
          'NODE_*', // Allow NODE_* variables
          'NPM_*', // Allow NPM_* variables
          'PUBLIC_*', // Allow PUBLIC_* variables
          '!SECRET_*', // Block SECRET_* variables
          '!BASH_FUNC_*', // Block bash functions
        ],
      });

      expect(result.processedEnv).toHaveProperty('NODE_VERSION');
      expect(result.processedEnv).toHaveProperty('NODE_OPTIONS');
      expect(result.processedEnv).toHaveProperty('NPM_CONFIG_PREFIX');
      expect(result.processedEnv).toHaveProperty('PUBLIC_VAR');
      expect(result.processedEnv).not.toHaveProperty('SECRET_KEY');
      expect(result.processedEnv).not.toHaveProperty('BASH_FUNC_test');
    });
  });
});
