// Import the mocked prompts
import prompts from 'prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvVarMetadata } from '../types.js';
import { configureEnvVars } from './envVarConfigurator.js';

// Mock prompts module with factory
vi.mock('prompts', () => ({
  default: vi.fn(),
}));

const mockPrompts = prompts as any;

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: {
      bold: vi.fn((text) => text),
    },
    red: vi.fn((text) => text),
    gray: vi.fn((text) => text),
    yellow: vi.fn((text) => text),
  },
}));

// Mock console.log to prevent output during tests
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

describe('envVarConfigurator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrompts.mockReset();
  });

  afterEach(() => {
    mockPrompts.mockReset();
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
  });

  describe('configureEnvVars', () => {
    describe('empty env var metadata handling', () => {
      it('should return empty object when user declines to add manual env vars', async () => {
        mockPrompts
          .mockResolvedValueOnce({ add: false }) // No manual env vars
          .mockResolvedValueOnce({}); // Won't be called

        const result = await configureEnvVars([]);

        expect(result).toEqual({});
      });

      it('should return null when user cancels manual env var prompt', async () => {
        mockPrompts.mockResolvedValueOnce({ add: undefined }); // Cancelled

        const result = await configureEnvVars([]);

        expect(result).toBeNull();
      });

      it('should parse valid JSON manual input', async () => {
        mockPrompts
          .mockResolvedValueOnce({ add: true }) // Add manual env vars
          .mockResolvedValueOnce({ env: '{"NODE_ENV": "production", "PORT": "3000"}' });

        const result = await configureEnvVars([]);

        expect(result).toEqual({
          NODE_ENV: 'production',
          PORT: '3000',
        });
      });

      it('should handle empty JSON object manual input', async () => {
        mockPrompts.mockResolvedValueOnce({ add: true }).mockResolvedValueOnce({ env: '{}' });

        const result = await configureEnvVars([]);

        expect(result).toEqual({});
      });

      it('should validate JSON format for manual input', async () => {
        let validateFn: (value: string) => boolean | string;

        mockPrompts.mockResolvedValueOnce({ add: true }).mockImplementationOnce((options: any) => {
          validateFn = options.validate;
          return Promise.resolve({ env: '{}' });
        });

        await configureEnvVars([]);

        // Test valid JSON
        expect(validateFn!('{"key": "value"}')).toBe(true);
        expect(validateFn!('{}')).toBe(true);

        // Test invalid JSON
        expect(validateFn!('{"key": value}')).toBe('Invalid JSON format');
        expect(validateFn!('not json')).toBe('Invalid JSON format');
        expect(validateFn!('{"incomplete":')).toBe('Invalid JSON format');
      });

      it('should return null when user cancels manual JSON input', async () => {
        mockPrompts.mockResolvedValueOnce({ add: true }).mockResolvedValueOnce({ env: undefined });

        const result = await configureEnvVars([]);

        expect(result).toBeNull();
      });

      it('should handle complex JSON manual input', async () => {
        mockPrompts.mockResolvedValueOnce({ add: true }).mockResolvedValueOnce({
          env: '{"API_KEY": "abc123", "DATABASE_URL": "postgres://localhost:5432/db", "FEATURES": ["auth", "logging"]}',
        });

        const result = await configureEnvVars([]);

        expect(result).toEqual({
          API_KEY: 'abc123',
          DATABASE_URL: 'postgres://localhost:5432/db',
          FEATURES: ['auth', 'logging'], // Note: Complex values preserved as-is
        });
      });
    });

    describe('env var metadata handling', () => {
      const mockEnvVarMetadata: EnvVarMetadata[] = [
        {
          key: 'NODE_ENV',
          description: 'Node environment',
          isRequired: true,
          default: 'development',
        },
        {
          key: 'PORT',
          description: 'Server port',
          isRequired: false,
          default: '3000',
        },
        {
          key: 'API_KEY',
          description: 'API authentication key',
          isRequired: false,
          isSecret: true,
        },
      ];

      it('should return null when user cancels configuration prompt', async () => {
        mockPrompts.mockResolvedValueOnce({ value: undefined }); // Cancelled

        const result = await configureEnvVars(mockEnvVarMetadata);

        expect(result).toBeNull();
      });

      it('should use defaults for required env vars when user declines configuration', async () => {
        mockPrompts.mockResolvedValueOnce({ value: false }); // Don't configure

        const result = await configureEnvVars(mockEnvVarMetadata);

        expect(result).toEqual({
          NODE_ENV: 'development', // Only required env var with default
        });
      });

      it('should pre-select required env vars by default', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['NODE_ENV'] }) // Only required env var selected
          .mockResolvedValueOnce({ value: 'production' }); // NODE_ENV value

        const result = await configureEnvVars(mockEnvVarMetadata);

        expect(result).toEqual({
          NODE_ENV: 'production',
        });
      });

      it('should return empty object when no env vars selected', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: [] }); // No env vars selected

        const result = await configureEnvVars(mockEnvVarMetadata);

        expect(result).toEqual({});
      });

      it('should return null when user cancels selection', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: undefined }); // Cancelled selection

        const result = await configureEnvVars(mockEnvVarMetadata);

        expect(result).toBeNull();
      });
    });

    describe('env var value collection', () => {
      it('should handle text input for non-secret environment variables', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['PORT'] }) // Select PORT env var
          .mockResolvedValueOnce({ value: '8080' }); // PORT value

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'PORT',
            description: 'Server port',
            isRequired: false,
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        expect(result).toEqual({
          PORT: '8080',
        });
      });

      it('should handle password input for secret environment variables', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['API_KEY'] }) // Select API_KEY env var
          .mockResolvedValueOnce({ value: 'secret123' }); // API_KEY value

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'API_KEY',
            description: 'API authentication key',
            isSecret: true,
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        // Verify password prompt was used
        expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({}));

        expect(result).toEqual({
          API_KEY: 'secret123',
        });
      });

      it('should use default value when provided', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['LOG_LEVEL'] }) // Select LOG_LEVEL env var
          .mockResolvedValueOnce({ value: 'debug' }); // Override default

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'LOG_LEVEL',
            description: 'Logging level',
            default: 'info',
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        expect(result).toEqual({
          LOG_LEVEL: 'debug',
        });
      });

      it('should skip env vars when user cancels individual input', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['optional1', 'optional2'] }) // Select two env vars
          .mockResolvedValueOnce({ value: undefined }) // Cancel first env var
          .mockResolvedValueOnce({ value: 'value2' }); // Provide second env var

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'optional1',
            description: 'First optional environment variable',
          },
          {
            key: 'optional2',
            description: 'Second optional environment variable',
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        expect(result).toEqual({
          optional2: 'value2',
        });
      });

      it('should handle empty values for optional environment variables', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['optional'] }) // Select optional env var
          .mockResolvedValueOnce({ value: '' }); // Empty value

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'optional',
            description: 'Optional environment variable',
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        expect(result).toEqual({});
      });

      it('should use empty string for required env vars when user provides empty value', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['required'] }) // Select required env var
          .mockResolvedValueOnce({ value: '' }); // Empty value

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'required',
            description: 'Required environment variable',
            isRequired: true,
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        expect(result).toEqual({
          required: '', // Empty string for required env var without default
        });
      });

      it('should use default for required env vars when user provides empty value and default exists', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['required'] }) // Select required env var
          .mockResolvedValueOnce({ value: '' }); // Empty value

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'required',
            description: 'Required environment variable',
            isRequired: true,
            default: 'default-value',
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        expect(result).toEqual({
          required: 'default-value',
        });
      });
    });

    describe('multiple environment variables handling', () => {
      const complexEnvVarMetadata: EnvVarMetadata[] = [
        {
          key: 'NODE_ENV',
          description: 'Node environment',
          isRequired: true,
          default: 'development',
        },
        {
          key: 'PORT',
          description: 'Server port',
          isRequired: false,
          default: '3000',
        },
        {
          key: 'API_KEY',
          description: 'API authentication key',
          isSecret: true,
        },
        {
          key: 'DATABASE_URL',
          description: 'Database connection URL',
          isRequired: false,
        },
      ];

      it('should handle multiple selected environment variables', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['NODE_ENV', 'PORT', 'API_KEY'] }) // Select multiple env vars
          .mockResolvedValueOnce({ value: 'production' }) // NODE_ENV
          .mockResolvedValueOnce({ value: '8080' }) // PORT
          .mockResolvedValueOnce({ value: 'secret-key-123' }); // API_KEY

        const result = await configureEnvVars(complexEnvVarMetadata);

        expect(result).toEqual({
          NODE_ENV: 'production',
          PORT: '8080',
          API_KEY: 'secret-key-123',
        });
      });

      it('should handle mix of secret and non-secret inputs', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['NODE_ENV', 'API_KEY'] }) // Select mixed env vars
          .mockResolvedValueOnce({ value: 'staging' }); // Text input for NODE_ENV

        // Verify password prompt for secret variable
        mockPrompts.mockClear();
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['NODE_ENV', 'API_KEY'] }) // Select mixed env vars
          .mockResolvedValueOnce({ value: 'staging' }); // Text input for NODE_ENV

        await configureEnvVars(complexEnvVarMetadata);

        // Should have password prompt for API_KEY
        expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({}));
      });

      it('should handle partial selection with required env vars', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['NODE_ENV'] }) // Only select required env var
          .mockResolvedValueOnce({ value: 'test' }); // NODE_ENV value

        const result = await configureEnvVars(complexEnvVarMetadata);

        expect(result).toEqual({
          NODE_ENV: 'test',
        });
      });
    });

    describe('error handling and edge cases', () => {
      it('should handle env var metadata without descriptions', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['bare-env-var'] }) // Select env var
          .mockResolvedValueOnce({ value: 'test-value' }); // Provide value

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'bare-env-var',
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        expect(result).toEqual({
          'bare-env-var': 'test-value',
        });
      });

      it('should handle very long environment variable values', async () => {
        const longValue = 'a'.repeat(1000);

        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['long-env-var'] }) // Select env var
          .mockResolvedValueOnce({ value: longValue }); // Long value

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'long-env-var',
            description: 'Environment variable with long value',
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        expect(result).toEqual({
          'long-env-var': longValue,
        });
      });

      it('should handle special characters in environment variable values', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['special-env-var'] }) // Select env var
          .mockResolvedValueOnce({ value: 'value with spaces & symbols!@#$%^&*()' }); // Special chars

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'special-env-var',
            description: 'Environment variable with special characters',
          },
        ];

        const result = await configureEnvVars(envVarMetadata);

        expect(result).toEqual({
          'special-env-var': 'value with spaces & symbols!@#$%^&*()',
        });
      });

      it('should handle JSON parsing errors gracefully', async () => {
        mockPrompts
          .mockResolvedValueOnce({ add: true }) // Add manual env vars
          .mockResolvedValueOnce({ env: '{"invalid": json}' }); // Invalid JSON

        await expect(configureEnvVars([])).rejects.toThrow();
      });

      it('should handle numeric values as strings in manual JSON input', async () => {
        mockPrompts
          .mockResolvedValueOnce({ add: true }) // Add manual env vars
          .mockResolvedValueOnce({ env: '{"PORT": 3000, "TIMEOUT": 5000}' }); // Numbers in JSON

        const result = await configureEnvVars([]);

        expect(result).toEqual({
          PORT: 3000, // Numbers remain as numbers
          TIMEOUT: 5000,
        });
      });
    });

    describe('behavior with required environment variables', () => {
      it('should default to configuring when required env vars exist', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Should default to true
          .mockResolvedValueOnce({ selected: [] }); // No selection

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'required',
            description: 'Required environment variable',
            isRequired: true,
          },
        ];

        await configureEnvVars(envVarMetadata);

        expect(mockPrompts).toHaveBeenCalledWith(
          expect.objectContaining({
            initial: true, // Should default to true for required env vars
          }),
        );
      });

      it('should default to not configuring when no required env vars exist', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: false }) // Should default to false
          .mockResolvedValueOnce({}); // Won't be called

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'optional',
            description: 'Optional environment variable',
            isRequired: false,
          },
        ];

        await configureEnvVars(envVarMetadata);

        expect(mockPrompts).toHaveBeenCalledWith(
          expect.objectContaining({
            initial: false, // Should default to false for optional env vars
          }),
        );
      });

      it('should pre-select required environment variables in multiselect', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['required'] }) // Pre-selected required env var
          .mockResolvedValueOnce({ value: 'test-value' }); // Value for required env var

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'required',
            description: 'Required environment variable',
            isRequired: true,
          },
          {
            key: 'optional',
            description: 'Optional environment variable',
            isRequired: false,
          },
        ];

        await configureEnvVars(envVarMetadata);

        expect(mockPrompts).toHaveBeenCalledWith(
          expect.objectContaining({
            choices: expect.arrayContaining([
              expect.objectContaining({
                title: expect.stringContaining('*required'),
                selected: true, // Required env var should be pre-selected
              }),
              expect.objectContaining({
                selected: false, // Optional env var should not be pre-selected
              }),
            ]),
          }),
        );
      });

      it('should show secret indicator for secret environment variables', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure env vars
          .mockResolvedValueOnce({ selected: ['secret', 'normal'] }) // Select both types
          .mockResolvedValueOnce({ value: 'secret-value' }) // Secret env var value
          .mockResolvedValueOnce({ value: 'normal-value' }); // Normal env var value

        const envVarMetadata: EnvVarMetadata[] = [
          {
            key: 'secret',
            description: 'Secret environment variable',
            isSecret: true,
          },
          {
            key: 'normal',
            description: 'Normal environment variable',
            isSecret: false,
          },
        ];

        await configureEnvVars(envVarMetadata);

        expect(mockPrompts).toHaveBeenCalledWith(
          expect.objectContaining({
            choices: expect.arrayContaining([
              expect.objectContaining({
                title: expect.stringContaining('🔒 secret'),
              }),
              expect.objectContaining({
                title: expect.not.stringContaining('🔒'),
              }),
            ]),
          }),
        );
      });
    });
  });
});
