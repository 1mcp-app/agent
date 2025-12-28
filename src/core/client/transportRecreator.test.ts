import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { AuthProviderTransport } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransportRecreator } from './transportRecreator.js';

describe('TransportRecreator', () => {
  let transportRecreator: TransportRecreator;

  beforeEach(() => {
    vi.clearAllMocks();
    transportRecreator = new TransportRecreator();
  });

  describe('recreateHttpTransport', () => {
    describe('StreamableHTTPClientTransport', () => {
      it('should recreate StreamableHTTPClientTransport', () => {
        const originalTransport = {
          _url: new URL('https://example.com/mcp'),
          oauthProvider: {
            token: 'test-token',
            getAuthorizationUrl: vi.fn(),
          },
          connectionTimeout: 5000,
          requestTimeout: 10000,
          timeout: 30000,
          tags: ['test', 'http'],
        } as unknown as AuthProviderTransport;
        Object.setPrototypeOf(originalTransport, StreamableHTTPClientTransport.prototype);

        const newTransport = transportRecreator.recreateHttpTransport(originalTransport, 'test-server');

        expect(newTransport).not.toBe(originalTransport);
        expect((newTransport as any)._url.href).toBe('https://example.com/mcp');
        expect(newTransport.oauthProvider).toBe(originalTransport.oauthProvider);
        expect(newTransport.connectionTimeout).toBe(5000);
        expect(newTransport.requestTimeout).toBe(10000);
        expect(newTransport.timeout).toBe(30000);
        expect(newTransport.tags).toEqual(['test', 'http']);
      });

      it('should preserve oauthProvider configuration', () => {
        const oauthProvider = {
          token: 'oauth-token-123',
          getAuthorizationUrl: vi.fn().mockReturnValue('https://auth.example.com/authorize'),
        } as any;

        const originalTransport = {
          _url: new URL('https://api.example.com/mcp'),
          oauthProvider,
          timeout: 15000,
        } as unknown as AuthProviderTransport;
        Object.setPrototypeOf(originalTransport, StreamableHTTPClientTransport.prototype);

        const newTransport = transportRecreator.recreateHttpTransport(originalTransport);

        expect(newTransport.oauthProvider).toBe(oauthProvider);
        expect((newTransport.oauthProvider as any).token).toBe('oauth-token-123');
      });
    });

    describe('SSEClientTransport', () => {
      it('should recreate SSEClientTransport', () => {
        const originalTransport = {
          _url: new URL('https://example.com/sse'),
          oauthProvider: {
            token: 'sse-token',
          },
          connectionTimeout: 3000,
          requestTimeout: 5000,
          timeout: 10000,
          tags: ['sse', 'events'],
        } as unknown as AuthProviderTransport;
        Object.setPrototypeOf(originalTransport, SSEClientTransport.prototype);

        const newTransport = transportRecreator.recreateHttpTransport(originalTransport, 'sse-server');

        expect(newTransport).not.toBe(originalTransport);
        expect((newTransport as any)._url.href).toBe('https://example.com/sse');
        expect(newTransport.oauthProvider).toBe(originalTransport.oauthProvider);
        expect(newTransport.connectionTimeout).toBe(3000);
        expect(newTransport.requestTimeout).toBe(5000);
        expect(newTransport.timeout).toBe(10000);
        expect(newTransport.tags).toEqual(['sse', 'events']);
      });

      it('should preserve SSE-specific properties', () => {
        const oauthProvider = {
          token: 'sse-oauth-token',
          getAuthorizationUrl: vi.fn().mockReturnValue('https://sse.example.com/auth'),
        };

        const originalTransport = {
          _url: new URL('https://sse.example.com/events'),
          oauthProvider,
          tags: ['sse', 'realtime'],
        } as unknown as AuthProviderTransport;
        Object.setPrototypeOf(originalTransport, SSEClientTransport.prototype);

        const newTransport = transportRecreator.recreateHttpTransport(originalTransport, 'sse-events');

        expect(newTransport.oauthProvider).toBe(oauthProvider);
        expect(newTransport.tags).toEqual(['sse', 'realtime']);
      });
    });

    describe('error handling', () => {
      it('should throw error for unsupported transport type', () => {
        const stdioTransport = {
          name: 'stdio',
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        } as unknown as AuthProviderTransport;

        expect(() => transportRecreator.recreateHttpTransport(stdioTransport)).toThrow('does not support OAuth');
      });

      it('should include server name in error message', () => {
        const stdioTransport = {
          name: 'stdio',
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        } as unknown as AuthProviderTransport;

        expect(() => transportRecreator.recreateHttpTransport(stdioTransport, 'my-stdio-server')).toThrow(
          'Transport for my-stdio-server does not support OAuth',
        );
      });

      it('should provide generic error message when server name is not provided', () => {
        const stdioTransport = {
          name: 'stdio',
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        } as unknown as AuthProviderTransport;

        expect(() => transportRecreator.recreateHttpTransport(stdioTransport)).toThrow(
          'Transport does not support OAuth',
        );
      });
    });

    describe('edge cases', () => {
      it('should handle transport with minimal properties', () => {
        const minimalTransport = {
          _url: new URL('https://minimal.example.com/mcp'),
          oauthProvider: { token: 'minimal' },
        } as unknown as AuthProviderTransport;
        Object.setPrototypeOf(minimalTransport, StreamableHTTPClientTransport.prototype);

        const newTransport = transportRecreator.recreateHttpTransport(minimalTransport);

        expect(newTransport.oauthProvider).toEqual({ token: 'minimal' });
        expect(newTransport.connectionTimeout).toBeUndefined();
        expect(newTransport.requestTimeout).toBeUndefined();
        expect(newTransport.timeout).toBeUndefined();
        expect(newTransport.tags).toBeUndefined();
      });

      it('should handle undefined optional properties', () => {
        const transportWithUndefined = {
          _url: new URL('https://example.com/mcp'),
          oauthProvider: { token: 'test' },
          connectionTimeout: undefined,
          requestTimeout: undefined,
          timeout: undefined,
          tags: undefined,
        } as unknown as AuthProviderTransport;
        Object.setPrototypeOf(transportWithUndefined, StreamableHTTPClientTransport.prototype);

        const newTransport = transportRecreator.recreateHttpTransport(transportWithUndefined);

        expect(newTransport.connectionTimeout).toBeUndefined();
        expect(newTransport.requestTimeout).toBeUndefined();
        expect(newTransport.timeout).toBeUndefined();
        expect(newTransport.tags).toBeUndefined();
      });

      it('should create independent transport instances', () => {
        const originalTransport = {
          _url: new URL('https://example.com/mcp'),
          oauthProvider: { token: 'original' },
          timeout: 5000,
          tags: ['original'],
        } as unknown as AuthProviderTransport;
        Object.setPrototypeOf(originalTransport, StreamableHTTPClientTransport.prototype);

        const newTransport1 = transportRecreator.recreateHttpTransport(originalTransport);
        const newTransport2 = transportRecreator.recreateHttpTransport(originalTransport);

        expect(newTransport1).not.toBe(newTransport2);
        expect(newTransport1).not.toBe(originalTransport);
        expect(newTransport2).not.toBe(originalTransport);

        // Modifying one should not affect the other
        newTransport1.tags = ['modified1'];
        newTransport2.tags = ['modified2'];

        expect(newTransport1.tags).toEqual(['modified1']);
        expect(newTransport2.tags).toEqual(['modified2']);
      });
    });
  });

  describe('URL handling', () => {
    it('should preserve URL exactly', () => {
      const testUrl = new URL('https://user:pass@example.com:8080/path?query=value#fragment');
      const transport = {
        _url: testUrl,
        oauthProvider: { token: 'test' },
      } as unknown as AuthProviderTransport;
      Object.setPrototypeOf(transport, StreamableHTTPClientTransport.prototype);

      const newTransport = transportRecreator.recreateHttpTransport(transport);

      expect((newTransport as any)._url.href).toBe(testUrl.href);
    });

    it('should handle different URL protocols', () => {
      const httpUrl = new URL('http://example.com/mcp');
      const httpsUrl = new URL('https://example.com/mcp');
      const wsUrl = new URL('ws://example.com/mcp');

      [httpUrl, httpsUrl, wsUrl].forEach((url) => {
        const transport = {
          _url: url,
          oauthProvider: { token: 'test' },
        } as unknown as AuthProviderTransport;
        Object.setPrototypeOf(transport, StreamableHTTPClientTransport.prototype);

        const newTransport = transportRecreator.recreateHttpTransport(transport);
        expect((newTransport as any)._url.href).toBe(url.href);
      });
    });
  });
});
