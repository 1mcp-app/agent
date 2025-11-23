import type { RegistryServer } from '@src/domains/registry/types.js';

import { describe, expect, it } from 'vitest';

import { extractArgMetadata, extractEnvVarMetadata } from './metadataExtractor.js';

describe('metadataExtractor', () => {
  describe('extractEnvVarMetadata', () => {
    it('should extract environment variables from server packages', () => {
      const server: Partial<RegistryServer> = {
        packages: [
          {
            identifier: 'test-package',
            registryType: 'npm',
            environmentVariables: [
              {
                name: 'API_KEY',
                description: 'API key for service',
                default: 'default-key',
                isRequired: true,
                isSecret: true,
              },
              {
                value: 'DATABASE_URL',
                description: 'Database connection string',
                isRequired: false,
              },
            ],
          },
        ],
      };

      const result = extractEnvVarMetadata(server as RegistryServer);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        key: 'API_KEY',
        description: 'API key for service',
        default: 'default-key',
        isRequired: true,
        isSecret: true,
      });
      expect(result[1]).toEqual({
        key: 'DATABASE_URL',
        description: 'Database connection string',
        isRequired: false,
        isSecret: undefined,
        default: undefined,
      });
    });

    it('should deduplicate environment variables across packages', () => {
      const server: Partial<RegistryServer> = {
        packages: [
          {
            identifier: 'package-1',
            registryType: 'npm',
            environmentVariables: [{ name: 'API_KEY', description: 'First definition' }],
          },
          {
            identifier: 'package-2',
            registryType: 'npm',
            environmentVariables: [{ name: 'API_KEY', description: 'Duplicate definition' }],
          },
        ],
      };

      const result = extractEnvVarMetadata(server as RegistryServer);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('API_KEY');
      expect(result[0].description).toBe('First definition');
    });

    it('should return empty array when no environment variables defined', () => {
      const server: Partial<RegistryServer> = {
        packages: [
          {
            identifier: 'test-package',
            registryType: 'npm',
          },
        ],
      };

      const result = extractEnvVarMetadata(server as RegistryServer);

      expect(result).toEqual([]);
    });

    it('should handle missing packages', () => {
      const server: Partial<RegistryServer> = {};

      const result = extractEnvVarMetadata(server as RegistryServer);

      expect(result).toEqual([]);
    });
  });

  describe('extractArgMetadata', () => {
    it('should extract arguments from packageArguments', () => {
      const server: Partial<RegistryServer> = {
        packages: [
          {
            identifier: 'test-package',
            registryType: 'npm',
            packageArguments: [
              {
                name: 'port',
                description: 'Server port',
                default: '3000',
                isRequired: true,
                type: 'number',
              },
            ],
          },
        ],
      };

      const result = extractArgMetadata(server as RegistryServer);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'port',
        description: 'Server port',
        default: '3000',
        isRequired: true,
        type: 'number',
        isSecret: undefined,
        choices: undefined,
        valueHint: undefined,
      });
    });

    it('should extract arguments from runtimeArguments', () => {
      const server: Partial<RegistryServer> = {
        packages: [
          {
            identifier: 'test-package',
            registryType: 'npm',
            runtimeArguments: [
              {
                name: 'log-level',
                description: 'Logging level',
                choices: ['debug', 'info', 'warn', 'error'],
                default: 'info',
              },
            ],
          },
        ],
      };

      const result = extractArgMetadata(server as RegistryServer);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'log-level',
        description: 'Logging level',
        choices: ['debug', 'info', 'warn', 'error'],
        default: 'info',
        isRequired: undefined,
        isSecret: undefined,
        type: undefined,
        valueHint: undefined,
      });
    });

    it('should combine packageArguments and runtimeArguments', () => {
      const server: Partial<RegistryServer> = {
        packages: [
          {
            identifier: 'test-package',
            registryType: 'npm',
            packageArguments: [{ name: 'port' }],
            runtimeArguments: [{ name: 'log-level' }],
          },
        ],
      };

      const result = extractArgMetadata(server as RegistryServer);

      expect(result).toHaveLength(2);
      expect(result.map((a) => a.name)).toEqual(['port', 'log-level']);
    });

    it('should deduplicate arguments across packages', () => {
      const server: Partial<RegistryServer> = {
        packages: [
          {
            identifier: 'package-1',
            registryType: 'npm',
            packageArguments: [{ name: 'port', description: 'First definition' }],
          },
          {
            identifier: 'package-2',
            registryType: 'npm',
            runtimeArguments: [{ name: 'port', description: 'Duplicate definition' }],
          },
        ],
      };

      const result = extractArgMetadata(server as RegistryServer);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('port');
      expect(result[0].description).toBe('First definition');
    });

    it('should return empty array when no arguments defined', () => {
      const server: Partial<RegistryServer> = {
        packages: [
          {
            identifier: 'test-package',
            registryType: 'npm',
          },
        ],
      };

      const result = extractArgMetadata(server as RegistryServer);

      expect(result).toEqual([]);
    });
  });
});
