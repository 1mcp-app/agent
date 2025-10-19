import { MCP_URI_SEPARATOR } from '@src/constants.js';

import { describe, expect, it } from 'vitest';

import { InvalidRequestError } from './errorTypes.js';
import { buildUri, parseUri } from './parsing.js';

describe('parseUri', () => {
  const separator = MCP_URI_SEPARATOR;

  describe('valid URI parsing', () => {
    it('should parse simple URIs correctly', () => {
      const result = parseUri('client_1mcp_resource', separator);
      expect(result).toEqual({
        clientName: 'client',
        resourceName: 'resource',
      });
    });

    it('should handle resource names with separators', () => {
      const result = parseUri('client_1mcp_path/to/resource_1mcp_with_1mcp_separators', separator);
      expect(result).toEqual({
        clientName: 'client',
        resourceName: 'path/to/resource_1mcp_with_1mcp_separators',
      });
    });

    it('should handle URIs with whitespace', () => {
      const result = parseUri('  client  _1mcp_  resource  ', separator);
      expect(result).toEqual({
        clientName: 'client',
        resourceName: 'resource',
      });
    });

    it('should handle different separators', () => {
      const result = parseUri('client::resource', '::');
      expect(result).toEqual({
        clientName: 'client',
        resourceName: 'resource',
      });
    });

    it('should handle single character separators', () => {
      const result = parseUri('client/resource', '/');
      expect(result).toEqual({
        clientName: 'client',
        resourceName: 'resource',
      });
    });

    it('should handle complex resource names', () => {
      const result = parseUri('myClient_1mcp_https://example.com/api/v1/users/123', separator);
      expect(result).toEqual({
        clientName: 'myClient',
        resourceName: 'https://example.com/api/v1/users/123',
      });
    });

    it('should handle file paths as resources', () => {
      const result = parseUri('filesystem_1mcp_C:\\Users\\name\\Documents\\file.txt', separator);
      expect(result).toEqual({
        clientName: 'filesystem',
        resourceName: 'C:\\Users\\name\\Documents\\file.txt',
      });
    });
  });

  describe('invalid URI validation', () => {
    it('should throw error for empty URI', () => {
      expect(() => parseUri('', separator)).toThrow(InvalidRequestError);
      expect(() => parseUri('', separator)).toThrow('URI must be a non-empty string');
    });

    it('should throw error for null/undefined URI', () => {
      expect(() => parseUri(null as any, separator)).toThrow(InvalidRequestError);
      expect(() => parseUri(undefined as any, separator)).toThrow(InvalidRequestError);
    });

    it('should throw error for non-string URI', () => {
      expect(() => parseUri(123 as any, separator)).toThrow(InvalidRequestError);
      expect(() => parseUri([] as any, separator)).toThrow(InvalidRequestError);
      expect(() => parseUri({} as any, separator)).toThrow(InvalidRequestError);
    });

    it('should throw error for whitespace-only URI', () => {
      expect(() => parseUri('   ', separator)).toThrow(InvalidRequestError);
      expect(() => parseUri('\\t\\n', separator)).toThrow(InvalidRequestError);
    });

    it('should throw error for empty separator', () => {
      expect(() => parseUri('client://resource', '')).toThrow(InvalidRequestError);
      expect(() => parseUri('client://resource', null as any)).toThrow(InvalidRequestError);
      expect(() => parseUri('client://resource', undefined as any)).toThrow(InvalidRequestError);
    });

    it('should throw error for non-string separator', () => {
      expect(() => parseUri('client://resource', 123 as any)).toThrow(InvalidRequestError);
      expect(() => parseUri('client://resource', [] as any)).toThrow(InvalidRequestError);
    });

    it('should throw error for missing separator', () => {
      expect(() => parseUri('clientresource', separator)).toThrow(InvalidRequestError);
      expect(() => parseUri('clientresource', separator)).toThrow(
        `Invalid URI format: missing separator '${separator}' in 'clientresource'`,
      );
    });

    it('should throw error for empty client name', () => {
      expect(() => parseUri('_1mcp_resource', separator)).toThrow(InvalidRequestError);
      expect(() => parseUri('_1mcp_resource', separator)).toThrow('Client name cannot be empty');
    });

    it('should throw error for empty resource name', () => {
      expect(() => parseUri('client_1mcp_', separator)).toThrow(InvalidRequestError);
      expect(() => parseUri('client_1mcp_', separator)).toThrow('Resource name cannot be empty');
    });

    it('should throw error for whitespace-only client name', () => {
      expect(() => parseUri('   _1mcp_resource', separator)).toThrow(InvalidRequestError);
      expect(() => parseUri('   _1mcp_resource', separator)).toThrow('Client name cannot be empty');
    });

    it('should throw error for whitespace-only resource name', () => {
      expect(() => parseUri('client_1mcp_   ', separator)).toThrow(InvalidRequestError);
      expect(() => parseUri('client_1mcp_   ', separator)).toThrow('Resource name cannot be empty');
    });
  });

  describe('edge cases', () => {
    it('should handle very long separators', () => {
      const longSeparator = ':::::::::::';
      const result = parseUri(`client${longSeparator}resource`, longSeparator);
      expect(result).toEqual({
        clientName: 'client',
        resourceName: 'resource',
      });
    });

    it('should handle separators at the beginning of resource name', () => {
      const result = parseUri('client_1mcp__1mcp_resource', separator);
      expect(result).toEqual({
        clientName: 'client',
        resourceName: '_1mcp_resource',
      });
    });

    it('should handle multiple consecutive separators in resource name', () => {
      const result = parseUri('client_1mcp_resource_1mcp__1mcp_more', separator);
      expect(result).toEqual({
        clientName: 'client',
        resourceName: 'resource_1mcp__1mcp_more',
      });
    });

    it('should handle unicode characters', () => {
      const result = parseUri('客户端_1mcp_资源/文件.txt', separator);
      expect(result).toEqual({
        clientName: '客户端',
        resourceName: '资源/文件.txt',
      });
    });

    it('should handle special characters in names', () => {
      const result = parseUri('client-123_test_1mcp_resource@domain.com:8080/path?query=value', separator);
      expect(result).toEqual({
        clientName: 'client-123_test',
        resourceName: 'resource@domain.com:8080/path?query=value',
      });
    });
  });
});

describe('buildUri', () => {
  const separator = MCP_URI_SEPARATOR;

  describe('valid URI building', () => {
    it('should build simple URIs correctly', () => {
      const result = buildUri('client', 'resource', separator);
      expect(result).toBe('client_1mcp_resource');
    });

    it('should handle whitespace in names', () => {
      const result = buildUri('  client  ', '  resource  ', separator);
      expect(result).toBe('client_1mcp_resource');
    });

    it('should handle different separators', () => {
      const result = buildUri('client', 'resource', '::');
      expect(result).toBe('client::resource');
    });

    it('should handle single character separators', () => {
      const result = buildUri('client', 'resource', '/');
      expect(result).toBe('client/resource');
    });

    it('should handle complex resource names', () => {
      const result = buildUri('myClient', 'https://example.com/api/v1/users/123', separator);
      expect(result).toBe('myClient_1mcp_https://example.com/api/v1/users/123');
    });

    it('should handle file paths as resources', () => {
      const result = buildUri('filesystem', 'C:\\Users\\name\\Documents\\file.txt', separator);
      expect(result).toBe('filesystem_1mcp_C:\\Users\\name\\Documents\\file.txt');
    });

    it('should handle unicode characters', () => {
      const result = buildUri('客户端', '资源/文件.txt', separator);
      expect(result).toBe('客户端_1mcp_资源/文件.txt');
    });

    it('should handle special characters in names', () => {
      const result = buildUri('client-123_test', 'resource@domain.com:8080/path?query=value', separator);
      expect(result).toBe('client-123_test_1mcp_resource@domain.com:8080/path?query=value');
    });
  });

  describe('invalid URI building', () => {
    it('should throw error for empty client name', () => {
      expect(() => buildUri('', 'resource', separator)).toThrow(InvalidRequestError);
      expect(() => buildUri('', 'resource', separator)).toThrow('Client name cannot be empty');
    });

    it('should throw error for whitespace-only client name', () => {
      expect(() => buildUri('   ', 'resource', separator)).toThrow(InvalidRequestError);
      expect(() => buildUri('   ', 'resource', separator)).toThrow('Client name cannot be empty');
    });

    it('should throw error for empty resource name', () => {
      expect(() => buildUri('client', '', separator)).toThrow(InvalidRequestError);
      expect(() => buildUri('client', '', separator)).toThrow('Resource name cannot be empty');
    });

    it('should throw error for whitespace-only resource name', () => {
      expect(() => buildUri('client', '   ', separator)).toThrow(InvalidRequestError);
      expect(() => buildUri('client', '   ', separator)).toThrow('Resource name cannot be empty');
    });

    it('should throw error for null/undefined client name', () => {
      expect(() => buildUri(null as any, 'resource', separator)).toThrow(InvalidRequestError);
      expect(() => buildUri(undefined as any, 'resource', separator)).toThrow(InvalidRequestError);
    });

    it('should throw error for null/undefined resource name', () => {
      expect(() => buildUri('client', null as any, separator)).toThrow(InvalidRequestError);
      expect(() => buildUri('client', undefined as any, separator)).toThrow(InvalidRequestError);
    });

    it('should throw error for empty separator', () => {
      expect(() => buildUri('client', 'resource', '')).toThrow(InvalidRequestError);
      expect(() => buildUri('client', 'resource', '')).toThrow('Separator must be a non-empty string');
    });

    it('should throw error for null/undefined separator', () => {
      expect(() => buildUri('client', 'resource', null as any)).toThrow(InvalidRequestError);
      expect(() => buildUri('client', 'resource', undefined as any)).toThrow(InvalidRequestError);
    });

    it('should throw error for non-string separator', () => {
      expect(() => buildUri('client', 'resource', 123 as any)).toThrow(InvalidRequestError);
      expect(() => buildUri('client', 'resource', [] as any)).toThrow(InvalidRequestError);
    });
  });

  describe('round-trip compatibility', () => {
    it('should be compatible with parseUri for simple cases', () => {
      const clientName = 'testClient';
      const resourceName = 'testResource';
      const uri = buildUri(clientName, resourceName, separator);
      const parsed = parseUri(uri, separator);

      expect(parsed.clientName).toBe(clientName);
      expect(parsed.resourceName).toBe(resourceName);
    });

    it('should be compatible with parseUri for complex cases', () => {
      const clientName = 'my-client_123';
      const resourceName = 'path/to/resource_1mcp_with_1mcp_separators';
      const uri = buildUri(clientName, resourceName, separator);
      const parsed = parseUri(uri, separator);

      expect(parsed.clientName).toBe(clientName);
      expect(parsed.resourceName).toBe(resourceName);
    });
  });
});
