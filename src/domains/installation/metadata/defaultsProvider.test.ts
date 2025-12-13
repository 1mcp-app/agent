import type { RegistryServer } from '@src/domains/registry/types.js';

import { describe, expect, it } from 'vitest';

import { extractDefaultArgs, extractDefaultEnvVars } from './defaultsProvider.js';

describe('defaultsProvider', () => {
  describe('extractDefaultEnvVars', () => {
    const mockServer: RegistryServer = {
      name: 'test-server',
      version: '1.0.0',
      description: 'Test server for unit testing',
      status: 'active',
      repository: {
        source: 'test',
        url: 'https://github.com/test/test-server',
      },
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          isLatest: true,
          publishedAt: '2024-01-01T00:00:00Z',
          status: 'active',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      },
    };

    it('should return empty object for server without packages', () => {
      const result = extractDefaultEnvVars(mockServer);

      expect(result).toEqual({});
    });

    it('should return empty object for server with empty packages array', () => {
      const serverWithEmptyPackages = {
        ...mockServer,
        packages: [],
      };

      const result = extractDefaultEnvVars(serverWithEmptyPackages);

      expect(result).toEqual({});
    });

    it('should extract environment variables from packages', () => {
      const serverWithEnvVars: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'NODE_ENV',
                description: 'Node environment',
                value: 'production',
                default: 'development',
                isRequired: false,
                isSecret: false,
              },
              {
                name: 'PORT',
                description: 'Server port',
                value: 'server-port',
                default: '3000',
                isRequired: false,
                isSecret: false,
              },
              {
                name: 'API_KEY',
                description: 'API key',
                value: 'api-key-value',
                isRequired: true,
                isSecret: true,
              },
            ],
          },
        ],
      };

      const result = extractDefaultEnvVars(serverWithEnvVars);

      expect(result).toEqual({
        PRODUCTION: 'development',
        SERVER_PORT: '3000',
        API_KEY_VALUE: '',
      });
    });

    it('should handle environment variables without default values', () => {
      const serverWithEnvVarsNoDefault: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'NO_DEFAULT_VAR',
                description: 'Variable without default',
                value: 'no-default-value',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultEnvVars(serverWithEnvVarsNoDefault);

      expect(result).toEqual({
        NO_DEFAULT_VALUE: '',
      });
    });

    it('should handle environment variables without value field', () => {
      const serverWithEnvVarsNoValue: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'NO_VALUE_VAR',
                description: 'Variable without value field',
                default: 'fallback-default',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultEnvVars(serverWithEnvVarsNoValue);

      expect(result).toEqual({});
    });

    it('should handle special characters in environment variable values', () => {
      const serverWithSpecialChars: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'SPECIAL_VAR',
                description: 'Variable with special characters',
                value: 'special-var.with.chars@123',
                default: 'default-value',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultEnvVars(serverWithSpecialChars);

      expect(result).toEqual({
        SPECIAL_VAR_WITH_CHARS_123: 'default-value',
      });
    });

    it('should handle multiple packages with environment variables', () => {
      const serverWithMultiplePackages: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'package1',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'VAR1',
                description: 'Variable from package 1',
                value: 'var1',
                default: 'default1',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
          {
            registryType: 'npm',
            identifier: 'package2',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'VAR2',
                description: 'Variable from package 2',
                value: 'var2',
                default: 'default2',
                isRequired: false,
                isSecret: false,
              },
              {
                name: 'VAR3',
                description: 'Another variable from package 2',
                value: 'var3',
                default: 'default3',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultEnvVars(serverWithMultiplePackages);

      expect(result).toEqual({
        VAR1: 'default1',
        VAR2: 'default2',
        VAR3: 'default3',
      });
    });

    it('should handle duplicate environment variable names from different packages', () => {
      const serverWithDuplicates: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'package1',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'COMMON_VAR',
                description: 'Common variable from package 1',
                value: 'common-var',
                default: 'default1',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
          {
            registryType: 'npm',
            identifier: 'package2',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'COMMON_VAR',
                description: 'Common variable from package 2',
                value: 'common-var',
                default: 'default2',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultEnvVars(serverWithDuplicates);

      expect(result).toEqual({
        COMMON_VAR: 'default2', // Last value wins
      });
    });

    it('should handle environment variable values with mixed case', () => {
      const serverWithMixedCase: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'MIXED_CASE_VAR',
                description: 'Variable with mixed case',
                value: 'MixedCase.Var_Name-123',
                default: 'default-mixed',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultEnvVars(serverWithMixedCase);

      expect(result).toEqual({
        MIXEDCASE_VAR_NAME_123: 'default-mixed',
      });
    });

    it('should handle environment variable values with numbers and underscores', () => {
      const serverWithComplexValue: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'COMPLEX_VAR',
                description: 'Variable with complex value',
                value: 'VAR_123_TEST_456',
                default: 'complex-default',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultEnvVars(serverWithComplexValue);

      expect(result).toEqual({
        VAR_123_TEST_456: 'complex-default',
      });
    });

    it('should handle environment variable values that are already uppercase', () => {
      const serverWithUppercaseValue: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'UPPERCASE_VAR',
                description: 'Variable with uppercase value',
                value: 'ALREADY_UPPERCASE',
                default: 'uppercase-default',
                isRequired: false,
                isSecret: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultEnvVars(serverWithUppercaseValue);

      expect(result).toEqual({
        ALREADY_UPPERCASE: 'uppercase-default',
      });
    });
  });

  describe('extractDefaultArgs', () => {
    const mockServer: RegistryServer = {
      name: 'test-server',
      version: '1.0.0',
      description: 'Test server for unit testing',
      status: 'active',
      repository: {
        source: 'test',
        url: 'https://github.com/test/test-server',
      },
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          isLatest: true,
          publishedAt: '2024-01-01T00:00:00Z',
          status: 'active',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      },
    };

    it('should return empty array for server without packages', () => {
      const result = extractDefaultArgs(mockServer);

      expect(result).toEqual([]);
    });

    it('should return empty array for server with empty packages array', () => {
      const serverWithEmptyPackages = {
        ...mockServer,
        packages: [],
      };

      const result = extractDefaultArgs(serverWithEmptyPackages);

      expect(result).toEqual([]);
    });

    it('should extract runtime arguments from packages', () => {
      const serverWithArgs: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            runtimeArguments: [
              {
                name: 'port',
                description: 'Server port',
                default: '--port=3000',
                isRequired: false,
              },
              {
                name: 'host',
                description: 'Server host',
                default: '--host=localhost',
                isRequired: false,
              },
              {
                name: 'debug',
                description: 'Debug mode',
                type: 'boolean',
                default: '--debug',
                isRequired: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultArgs(serverWithArgs);

      expect(result).toEqual(['--port=3000', '--host=localhost', '--debug']);
    });

    it('should ignore runtime arguments without default values', () => {
      const serverWithArgsNoDefault: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            runtimeArguments: [
              {
                name: 'no-default-arg',
                description: 'Argument without default',
                isRequired: false,
              },
              {
                name: 'empty-default-arg',
                description: 'Argument with empty default',
                default: '',
                isRequired: false,
              },
              {
                name: 'valid-arg',
                description: 'Argument with default',
                default: '--valid=value',
                isRequired: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultArgs(serverWithArgsNoDefault);

      expect(result).toEqual(['--valid=value']);
    });

    it('should handle multiple packages with runtime arguments', () => {
      const serverWithMultiplePackages: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'package1',
            version: '1.0.0',
            runtimeArguments: [
              {
                name: 'arg1',
                description: 'Argument from package 1',
                default: '--arg1=value1',
                isRequired: false,
              },
            ],
          },
          {
            registryType: 'npm',
            identifier: 'package2',
            version: '1.0.0',
            runtimeArguments: [
              {
                name: 'arg2',
                description: 'Argument from package 2',
                default: '--arg2=value2',
                isRequired: false,
              },
              {
                name: 'arg3',
                description: 'Another argument from package 2',
                default: '--arg3=value3',
                isRequired: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultArgs(serverWithMultiplePackages);

      expect(result).toEqual(['--arg1=value1', '--arg2=value2', '--arg3=value3']);
    });

    it('should handle runtime arguments with complex default values', () => {
      const serverWithComplexArgs: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            runtimeArguments: [
              {
                name: 'complex-arg',
                description: 'Complex argument',
                default: '--complex="value with spaces"',
                isRequired: false,
              },
              {
                name: 'flag-arg',
                description: 'Flag argument',
                type: 'boolean',
                default: '--enable-feature',
                isRequired: false,
              },
              {
                name: 'number-arg',
                description: 'Number argument',
                default: '--timeout=5000',
                isRequired: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultArgs(serverWithComplexArgs);

      expect(result).toEqual(['--complex="value with spaces"', '--enable-feature', '--timeout=5000']);
    });

    it('should handle very long default argument values', () => {
      const longValue = '--very-long-argument=' + 'a'.repeat(1000);
      const serverWithLongArg: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            runtimeArguments: [
              {
                name: 'long-arg',
                description: 'Argument with long default value',
                default: longValue,
                isRequired: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultArgs(serverWithLongArg);

      expect(result).toEqual([longValue]);
    });

    it('should handle runtime arguments with special characters', () => {
      const serverWithSpecialChars: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            runtimeArguments: [
              {
                name: 'special-arg',
                description: 'Argument with special characters',
                default: '--special="value & symbols!@#$%^&*()"',
                isRequired: false,
              },
              {
                name: 'unicode-arg',
                description: 'Argument with unicode characters',
                default: '--unicode="café résumé naïve"',
                isRequired: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultArgs(serverWithSpecialChars);

      expect(result).toEqual(['--special="value & symbols!@#$%^&*()"', '--unicode="café résumé naïve"']);
    });

    it('should handle duplicate runtime arguments from different packages', () => {
      const serverWithDuplicateArgs: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'package1',
            version: '1.0.0',
            runtimeArguments: [
              {
                name: 'common-arg',
                description: 'Common argument from package 1',
                default: '--common=value1',
                isRequired: false,
              },
            ],
          },
          {
            registryType: 'npm',
            identifier: 'package2',
            version: '1.0.0',
            runtimeArguments: [
              {
                name: 'common-arg',
                description: 'Common argument from package 2',
                default: '--common=value2',
                isRequired: false,
              },
            ],
          },
        ],
      };

      const result = extractDefaultArgs(serverWithDuplicateArgs);

      expect(result).toEqual(['--common=value1', '--common=value2']); // Both are included
    });

    it('should handle packages with mixed environment variables and runtime arguments', () => {
      const serverWithMixedMetadata: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'main-package',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'MIXED_ENV',
                description: 'Environment variable',
                value: 'mixed-env',
                default: 'env-default',
                isRequired: false,
                isSecret: false,
              },
            ],
            runtimeArguments: [
              {
                name: 'mixed-arg',
                description: 'Runtime argument',
                default: '--mixed=arg-value',
                isRequired: false,
              },
            ],
          },
        ],
      };

      const envResult = extractDefaultEnvVars(serverWithMixedMetadata);
      const argsResult = extractDefaultArgs(serverWithMixedMetadata);

      expect(envResult).toEqual({
        MIXED_ENV: 'env-default',
      });
      expect(argsResult).toEqual(['--mixed=arg-value']);
    });

    it('should handle malformed package data gracefully', () => {
      const serverWithMalformedData: RegistryServer = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm',
            identifier: 'malformed-package',
            version: '1.0.0',
            // @ts-expect-error - Intentionally malformed data
            environmentVariables: 'not-an-array',
            // @ts-expect-error - Intentionally malformed data
            runtimeArguments: null,
          },
          {
            registryType: 'npm',
            identifier: 'valid-package',
            version: '1.0.0',
            environmentVariables: [
              {
                name: 'VALID_VAR',
                description: 'Valid variable',
                value: 'valid-var',
                default: 'valid-default',
                isRequired: false,
                isSecret: false,
              },
            ],
            runtimeArguments: [
              {
                name: 'valid-arg',
                description: 'Valid argument',
                default: '--valid=value',
                isRequired: false,
              },
            ],
          },
        ],
      };

      // Should not throw errors and process valid package
      const envResult = extractDefaultEnvVars(serverWithMalformedData);
      const argsResult = extractDefaultArgs(serverWithMalformedData);

      expect(envResult).toEqual({
        VALID_VAR: 'valid-default',
      });
      expect(argsResult).toEqual(['--valid=value']);
    });
  });
});
