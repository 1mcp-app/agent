import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PresetError, PresetErrorHandler } from './presetErrorHandler.js';

describe('PresetError', () => {
  it('should create error with default options', () => {
    const error = new PresetError('Test error');

    expect(error.name).toBe('PresetError');
    expect(error.message).toBe('Test error');
    expect(error.context).toBeUndefined();
    expect(error.userMessage).toBeUndefined();
    expect(error.exitCode).toBeUndefined();
    expect(error.logLevel).toBe('error');
  });

  it('should create error with custom options', () => {
    const options = {
      context: 'test context',
      userMessage: 'User friendly message',
      exitCode: 42,
      logLevel: 'warn' as const,
    };

    const error = new PresetError('Test error', options);

    expect(error.context).toBe('test context');
    expect(error.userMessage).toBe('User friendly message');
    expect(error.exitCode).toBe(42);
    expect(error.logLevel).toBe('warn');
  });
});

describe('PresetErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('throwError', () => {
    it('should throw PresetError with message', () => {
      expect(() => {
        PresetErrorHandler.throwError('Test error');
      }).toThrow(PresetError);

      expect(() => {
        PresetErrorHandler.throwError('Test error');
      }).toThrow('Test error');
    });

    it('should throw PresetError with options', () => {
      const options = {
        context: 'test context',
        userMessage: 'User message',
        exitCode: 99,
        logLevel: 'warn' as const,
      };

      try {
        PresetErrorHandler.throwError('Test error', options);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe('Test error');
        expect((error as PresetError).context).toBe('test context');
        expect((error as PresetError).userMessage).toBe('User message');
        expect((error as PresetError).exitCode).toBe(99);
        expect((error as PresetError).logLevel).toBe('warn');
      }
    });
  });

  describe('handleCliError', () => {
    it('should handle PresetError with user message', () => {
      const error = new PresetError('Internal error', {
        userMessage: 'Something went wrong',
        context: 'test context',
        exitCode: 42,
      });

      expect(() => {
        PresetErrorHandler.handleCliError(error);
      }).toThrow('process.exit unexpectedly called with "42"');
    });

    it('should handle PresetError without user message', () => {
      const error = new PresetError('Internal error', {
        exitCode: 1,
      });

      expect(() => {
        PresetErrorHandler.handleCliError(error);
      }).toThrow('process.exit unexpectedly called with "1"');
    });

    it('should handle PresetError with context parameter', () => {
      const error = new PresetError('Internal error');

      expect(() => {
        PresetErrorHandler.handleCliError(error, 'additional context');
      }).toThrow('process.exit unexpectedly called with "1"');
    });

    it('should handle regular Error', () => {
      const error = new Error('Regular error');

      expect(() => {
        PresetErrorHandler.handleCliError(error);
      }).toThrow('process.exit unexpectedly called with "1"');
    });

    it('should handle regular Error with context', () => {
      const error = new Error('Regular error');

      expect(() => {
        PresetErrorHandler.handleCliError(error, 'error context');
      }).toThrow('process.exit unexpectedly called with "1"');
    });

    it('should handle unknown error type', () => {
      const error = 'string error';

      expect(() => {
        PresetErrorHandler.handleCliError(error);
      }).toThrow('process.exit unexpectedly called with "1"');
    });

    it('should handle unknown error with context', () => {
      const error = { some: 'object' };

      expect(() => {
        PresetErrorHandler.handleCliError(error, 'parsing');
      }).toThrow('process.exit unexpectedly called with "1"');
    });
  });

  describe('validationError', () => {
    it('should throw validation error without field', () => {
      try {
        PresetErrorHandler.validationError('Invalid input');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe('Invalid input');
        expect((error as PresetError).userMessage).toBe('Invalid input');
        expect((error as PresetError).context).toBe('validation');
      }
    });

    it('should throw validation error with field', () => {
      try {
        PresetErrorHandler.validationError('must be string', 'name');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe('must be string');
        expect((error as PresetError).userMessage).toBe('Invalid name: must be string');
        expect((error as PresetError).context).toBe('validation');
      }
    });

    it('should throw validation error with custom options', () => {
      try {
        PresetErrorHandler.validationError('Invalid', 'field', {
          context: 'custom context',
          exitCode: 99,
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).context).toBe('custom context');
        expect((error as PresetError).exitCode).toBe(99);
      }
    });
  });

  describe('fileError', () => {
    it('should throw file read error', () => {
      const fileError = new Error('Permission denied');

      try {
        PresetErrorHandler.fileError('read', '/path/to/file', fileError);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe('Failed to reading file: Permission denied');
        expect((error as PresetError).context).toBe('file read');
        expect((error as PresetError).userMessage).toBe('Could not reading preset file: /path/to/file');
        expect((error as PresetError).exitCode).toBe(2);
      }
    });

    it('should throw file write error', () => {
      const fileError = new Error('Disk full');

      try {
        PresetErrorHandler.fileError('write', '/path/to/file', fileError);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe('Failed to writing file: Disk full');
        expect((error as PresetError).context).toBe('file write');
        expect((error as PresetError).userMessage).toBe('Could not writing preset file: /path/to/file');
      }
    });

    it('should throw file delete error', () => {
      const fileError = new Error('File not found');

      try {
        PresetErrorHandler.fileError('delete', '/path/to/file', fileError);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe('Failed to deleting file: File not found');
        expect((error as PresetError).context).toBe('file delete');
        expect((error as PresetError).userMessage).toBe('Could not deleting preset file: /path/to/file');
      }
    });

    it('should handle unknown error in file operations', () => {
      const unknownError = 'string error';

      try {
        PresetErrorHandler.fileError('read', '/path/to/file', unknownError);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe('Failed to reading file: Unknown error');
      }
    });
  });

  describe('parseError', () => {
    it('should throw parse error', () => {
      const parseError = new Error('Syntax error at line 5');

      try {
        PresetErrorHandler.parseError('invalid expression', parseError);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe('Failed to parse filter expression: Syntax error at line 5');
        expect((error as PresetError).context).toBe('filter parsing');
        expect((error as PresetError).userMessage).toBe('Invalid filter expression: "invalid expression"');
        expect((error as PresetError).exitCode).toBe(1);
      }
    });

    it('should throw parse error with custom options', () => {
      const parseError = new Error('Parse failed');

      try {
        PresetErrorHandler.parseError('expression', parseError, {
          exitCode: 99,
          context: 'custom parsing',
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).exitCode).toBe(99);
        expect((error as PresetError).context).toBe('custom parsing');
      }
    });

    it('should handle unknown parse error', () => {
      const unknownError = { message: 'object error' };

      try {
        PresetErrorHandler.parseError('expression', unknownError);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe('Failed to parse filter expression: Unknown error');
      }
    });
  });

  describe('notFoundError', () => {
    it('should throw preset not found error', () => {
      try {
        PresetErrorHandler.notFoundError('preset', 'my-preset');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe("preset 'my-preset' not found");
        expect((error as PresetError).context).toBe('preset lookup');
        expect((error as PresetError).userMessage).toBe('No preset found with name: my-preset');
        expect((error as PresetError).exitCode).toBe(4);
      }
    });

    it('should throw server not found error', () => {
      try {
        PresetErrorHandler.notFoundError('server', 'my-server');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe("server 'my-server' not found");
        expect((error as PresetError).context).toBe('server lookup');
      }
    });

    it('should throw config not found error', () => {
      try {
        PresetErrorHandler.notFoundError('config', 'my-config');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).message).toBe("config 'my-config' not found");
        expect((error as PresetError).context).toBe('config lookup');
      }
    });

    it('should throw not found error with custom options', () => {
      try {
        PresetErrorHandler.notFoundError('preset', 'test', {
          exitCode: 99,
          userMessage: 'Custom message',
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PresetError);
        expect((error as PresetError).exitCode).toBe(99);
        expect((error as PresetError).userMessage).toBe('Custom message');
      }
    });
  });

  describe('withErrorHandling', () => {
    it('should execute function successfully', () => {
      const fn = vi.fn().mockReturnValue('success');
      const result = PresetErrorHandler.withErrorHandling(fn, 'test context');

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should pass through PresetError', () => {
      const error = new PresetError('Original error');
      const fn = vi.fn().mockImplementation(() => {
        throw error;
      });

      expect(() => {
        PresetErrorHandler.withErrorHandling(fn, 'test context');
      }).toThrow(error);
    });

    it('should wrap regular errors', () => {
      const error = new Error('Regular error');
      const fn = vi.fn().mockImplementation(() => {
        throw error;
      });

      try {
        PresetErrorHandler.withErrorHandling(fn, 'test context');
        expect.fail('Should have thrown an error');
      } catch (wrappedError) {
        expect(wrappedError).toBeInstanceOf(PresetError);
        expect((wrappedError as PresetError).message).toBe('test context: Regular error');
        expect((wrappedError as PresetError).context).toBe('test context');
      }
    });

    it('should handle unknown errors', () => {
      const error = 'string error';
      const fn = vi.fn().mockImplementation(() => {
        throw error;
      });

      try {
        PresetErrorHandler.withErrorHandling(fn, 'test context');
        expect.fail('Should have thrown an error');
      } catch (wrappedError) {
        expect(wrappedError).toBeInstanceOf(PresetError);
        expect((wrappedError as PresetError).message).toBe('test context: Unknown error');
      }
    });

    it('should use context from options when no context parameter', () => {
      const error = new Error('Regular error');
      const fn = vi.fn().mockImplementation(() => {
        throw error;
      });

      try {
        PresetErrorHandler.withErrorHandling(fn, undefined, {
          context: 'options context',
          exitCode: 99,
        });
        expect.fail('Should have thrown an error');
      } catch (wrappedError) {
        expect(wrappedError).toBeInstanceOf(PresetError);
        expect((wrappedError as PresetError).context).toBe('options context');
        expect((wrappedError as PresetError).exitCode).toBe(99);
      }
    });
  });

  describe('createFilterError', () => {
    it('should display filter examples and throw parse error', () => {
      expect(() => {
        PresetErrorHandler.createFilterError('invalid filter');
      }).toThrow('Failed to parse filter expression');
    });
  });

  describe('logError', () => {
    it('should call logError without throwing', () => {
      const error = new PresetError('Test error', {
        context: 'test context',
        userMessage: 'User message',
        exitCode: 99,
        logLevel: 'warn',
      });

      // Should not throw
      expect(() => {
        PresetErrorHandler.logError(error, 'additional context');
      }).not.toThrow();
    });

    it('should handle regular Error without throwing', () => {
      const error = new Error('Regular error');

      expect(() => {
        PresetErrorHandler.logError(error, 'context');
      }).not.toThrow();
    });

    it('should handle unknown error without throwing', () => {
      const error = 'string error';

      expect(() => {
        PresetErrorHandler.logError(error);
      }).not.toThrow();
    });

    it('should handle logger import failure gracefully', () => {
      const error = new Error('Test error');

      expect(() => {
        PresetErrorHandler.logError(error);
      }).not.toThrow();
    });
  });
});
