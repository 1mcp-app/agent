import prompts from 'prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArgMetadata } from '../types.js';
import { configureCliArgs } from './cliArgsConfigurator.js';

// Mock prompts module with factory
vi.mock('prompts', () => ({
  default: vi.fn(),
}));

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: {
      bold: vi.fn((text: string) => text),
    },
    red: vi.fn((text: string) => text),
    gray: vi.fn((text: string) => text),
    yellow: vi.fn((text: string) => text),
  },
}));

describe('cliArgsConfigurator', () => {
  let mockPrompts: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrompts = prompts as any;
    mockPrompts.mockClear();
  });

  describe('configureCliArgs', () => {
    describe('empty arg metadata handling', () => {
      it('should return empty array when user declines to add manual args', async () => {
        mockPrompts.mockResolvedValueOnce({ add: false }); // No manual args

        const result = await configureCliArgs([]);

        expect(result).toEqual([]);
        expect(mockPrompts).toHaveBeenCalledTimes(1);
      });

      it('should return null when user cancels manual arg prompt', async () => {
        mockPrompts.mockResolvedValueOnce({ add: undefined }); // Cancelled

        const result = await configureCliArgs([]);

        expect(result).toBeNull();
        expect(mockPrompts).toHaveBeenCalledTimes(1);
      });

      it('should parse valid JSON manual input', async () => {
        mockPrompts
          .mockResolvedValueOnce({ add: true }) // Add manual args
          .mockResolvedValueOnce({ args: '["--verbose", "--port=3000"]' });

        const result = await configureCliArgs([]);

        expect(result).toEqual(['--verbose', '--port=3000']);
        expect(mockPrompts).toHaveBeenCalledTimes(2);
      });

      it('should handle empty string manual input as empty array', async () => {
        mockPrompts
          .mockResolvedValueOnce({ add: true }) // Add manual args
          .mockResolvedValueOnce({ args: '' });

        const result = await configureCliArgs([]);

        expect(result).toEqual([]);
        expect(mockPrompts).toHaveBeenCalledTimes(2);
      });

      it('should handle comma-separated manual input', async () => {
        mockPrompts
          .mockResolvedValueOnce({ add: true }) // Add manual args
          .mockResolvedValueOnce({ args: '--verbose, --port=3000' });

        const result = await configureCliArgs([]);

        expect(result).toEqual(['--verbose', '--port=3000']);
        expect(mockPrompts).toHaveBeenCalledTimes(2);
      });

      it('should return null when user cancels manual args input', async () => {
        mockPrompts
          .mockResolvedValueOnce({ add: true }) // Add manual args
          .mockResolvedValueOnce({ args: undefined }); // Cancelled

        const result = await configureCliArgs([]);

        expect(result).toBeNull();
        expect(mockPrompts).toHaveBeenCalledTimes(2);
      });
    });

    describe('argument metadata handling', () => {
      const mockArgMetadata: ArgMetadata[] = [
        {
          name: 'port',
          description: 'Server port',
          type: 'number',
          isRequired: true,
          default: '8080',
        },
        {
          name: 'debug',
          description: 'Enable debug mode',
          type: 'boolean',
          isRequired: false,
        },
      ];

      it('should return null when user cancels configuration prompt', async () => {
        mockPrompts.mockResolvedValueOnce({ value: undefined }); // Cancel configuration

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toBeNull();
        expect(mockPrompts).toHaveBeenCalledTimes(1);
      });

      it('should return defaults when user declines configuration but has required args', async () => {
        mockPrompts.mockResolvedValueOnce({ value: false }); // Decline configuration

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['port=8080']);
        expect(mockPrompts).toHaveBeenCalledTimes(1);
      });

      it('should pre-select required args by default', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['port'] }) // Pre-selected required
          .mockResolvedValueOnce({ port: '3000' }); // User input

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['port=3000']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });

      it('should return empty array when no args selected', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: [] }); // No args selected

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual([]);
        expect(mockPrompts).toHaveBeenCalledTimes(2);
      });

      it('should return null when user cancels selection', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: undefined }); // Cancelled

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toBeNull();
        expect(mockPrompts).toHaveBeenCalledTimes(2);
      });
    });

    describe('argument value collection', () => {
      const mockArgMetadata: ArgMetadata[] = [
        {
          name: 'name',
          description: 'Server name',
          type: 'string',
          isRequired: true,
        },
        {
          name: 'env',
          description: 'Environment',
          type: 'choice',
          isRequired: false,
          choices: ['development', 'production', 'test'],
        },
        {
          name: 'timeout',
          description: 'Timeout in seconds',
          type: 'number',
          isRequired: false,
          default: '30',
        },
      ];

      it('should handle text input for arguments without choices', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['name'] }) // Select name
          .mockResolvedValueOnce({ name: 'my-server' }); // Text input

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['name=my-server']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });

      it('should handle choice selection for arguments with choices', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['env'] }) // Select env
          .mockResolvedValueOnce({ env: 'production' }); // Choice selection

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['env=production']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });

      it('should use default value when provided', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['timeout'] }) // Select timeout
          .mockResolvedValueOnce({ timeout: undefined }); // Use default

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['timeout=30']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });

      it('should skip arguments when user cancels individual input', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['name', 'env'] }) // Select both
          .mockResolvedValueOnce({ name: undefined }) // Cancel name
          .mockResolvedValueOnce({ env: 'test' }); // Still provide env

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['env=test']);
        expect(mockPrompts).toHaveBeenCalledTimes(4);
      });

      it('should handle empty values for optional arguments', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['env'] }) // Select env
          .mockResolvedValueOnce({ env: '' }); // Empty value

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['env=']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });

      it('should use default for required args when user provides empty value', async () => {
        const mockWithDefault: ArgMetadata[] = [
          {
            name: 'port',
            description: 'Server port',
            type: 'number',
            isRequired: true,
            default: '8080',
          },
        ];

        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['port'] }) // Select port
          .mockResolvedValueOnce({ port: '' }); // Empty value for required

        const result = await configureCliArgs(mockWithDefault);

        expect(result).toEqual(['port=8080']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });
    });

    describe('multiple arguments handling', () => {
      const mockArgMetadata: ArgMetadata[] = [
        {
          name: 'port',
          description: 'Server port',
          type: 'number',
          isRequired: true,
        },
        {
          name: 'debug',
          description: 'Enable debug mode',
          type: 'boolean',
          isRequired: false,
        },
        {
          name: 'env',
          description: 'Environment',
          type: 'choice',
          isRequired: false,
          choices: ['dev', 'prod'],
        },
      ];

      it('should handle multiple selected arguments', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['port', 'debug'] }) // Select two
          .mockResolvedValueOnce({ port: '3000' }) // First arg
          .mockResolvedValueOnce({ debug: 'true' }); // Second arg

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['port=3000', 'debug=true']);
        expect(mockPrompts).toHaveBeenCalledTimes(4);
      });

      it('should handle mix of choice and text inputs', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['port', 'env'] }) // Select mixed
          .mockResolvedValueOnce({ port: '8080' }) // Text input
          .mockResolvedValueOnce({ env: 'prod' }); // Choice input

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['port=8080', 'env=prod']);
        expect(mockPrompts).toHaveBeenCalledTimes(4);
      });

      it('should handle partial selection with required args', async () => {
        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['port'] }) // Only select required
          .mockResolvedValueOnce({ port: '9000' });

        const result = await configureCliArgs(mockArgMetadata);

        expect(result).toEqual(['port=9000']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });
    });

    describe('error handling and edge cases', () => {
      it('should handle arg metadata without names', async () => {
        const invalidMetadata: ArgMetadata[] = [
          {
            name: '',
            description: 'Unnamed arg',
            type: 'string',
            isRequired: false,
          },
        ] as any;

        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: [] }); // Don't select invalid

        const result = await configureCliArgs(invalidMetadata);

        expect(result).toEqual([]);
        expect(mockPrompts).toHaveBeenCalledTimes(2);
      });

      it('should handle arg metadata without descriptions', async () => {
        const noDescMetadata: ArgMetadata[] = [
          {
            name: 'test',
            description: '',
            type: 'string',
            isRequired: false,
          },
        ];

        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['test'] }) // Select
          .mockResolvedValueOnce({ test: 'value' });

        const result = await configureCliArgs(noDescMetadata);

        expect(result).toEqual(['test=value']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });

      it('should handle choice arguments without default', async () => {
        const noDefaultChoice: ArgMetadata[] = [
          {
            name: 'level',
            description: 'Log level',
            type: 'choice',
            isRequired: false,
            choices: ['info', 'debug', 'error'],
          },
        ];

        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['level'] }) // Select
          .mockResolvedValueOnce({ level: 'debug' });

        const result = await configureCliArgs(noDefaultChoice);

        expect(result).toEqual(['level=debug']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });

      it('should handle very long argument values', async () => {
        const longValue = 'a'.repeat(1000);

        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['name'] }) // Select
          .mockResolvedValueOnce({ name: longValue });

        const result = await configureCliArgs([
          {
            name: 'name',
            description: 'Server name',
            type: 'string',
            isRequired: false,
          },
        ]);

        expect(result).toEqual([`name=${longValue}`]);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });

      it('should handle special characters in argument values', async () => {
        const specialChars = '!@#$%^&*()[]{}|;:,.<>?';

        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Configure
          .mockResolvedValueOnce({ selected: ['password'] }) // Select
          .mockResolvedValueOnce({ password: specialChars });

        const result = await configureCliArgs([
          {
            name: 'password',
            description: 'Password',
            type: 'string',
            isRequired: false,
          },
        ]);

        expect(result).toEqual([`password=${specialChars}`]);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });
    });

    describe('behavior with required arguments', () => {
      it('should default to configuring when required args exist', async () => {
        const requiredArgs: ArgMetadata[] = [
          {
            name: 'host',
            description: 'Server host',
            type: 'string',
            isRequired: true,
          },
        ];

        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Will default to true for required args
          .mockResolvedValueOnce({ selected: ['host'] }) // Pre-selected
          .mockResolvedValueOnce({ host: 'localhost' });

        const result = await configureCliArgs(requiredArgs);

        expect(result).toEqual(['host=localhost']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });

      it('should default to not configuring when no required args exist', async () => {
        const optionalArgs: ArgMetadata[] = [
          {
            name: 'verbose',
            description: 'Verbose output',
            type: 'boolean',
            isRequired: false,
          },
        ];

        mockPrompts.mockResolvedValueOnce({ value: false }); // User declines

        const result = await configureCliArgs(optionalArgs);

        expect(result).toBeNull();
        expect(mockPrompts).toHaveBeenCalledTimes(1);
      });

      it('should pre-select required arguments in multiselect', async () => {
        const mixedArgs: ArgMetadata[] = [
          {
            name: 'required',
            description: 'Required arg',
            type: 'string',
            isRequired: true,
          },
          {
            name: 'optional',
            description: 'Optional arg',
            type: 'string',
            isRequired: false,
          },
        ];

        mockPrompts
          .mockResolvedValueOnce({ value: true }) // Default to configure for required args
          .mockResolvedValueOnce({ selected: ['required'] }) // Only required pre-selected
          .mockResolvedValueOnce({ required: 'value' });

        const result = await configureCliArgs(mixedArgs);

        expect(result).toEqual(['required=value']);
        expect(mockPrompts).toHaveBeenCalledTimes(3);
      });
    });
  });
});
