import { ErrorCode, hasHttpErrorCode } from './protocol.js';

describe('plain protocol contracts', () => {
  it('keeps the stable error code values', () => {
    expect(ErrorCode).toMatchObject({
      ConnectionClosed: -32000,
      RequestTimeout: -32001,
      ParseError: -32700,
      InvalidRequest: -32600,
      MethodNotFound: -32601,
      InvalidParams: -32602,
      InternalError: -32603,
      UrlElicitationRequired: -32042,
    });
  });

  it('recognizes HTTP error facts without relying on class identity', () => {
    expect(hasHttpErrorCode({ code: 404 }, 404)).toBe(true);
    expect(hasHttpErrorCode({ code: '404' }, 404)).toBe(false);
    expect(hasHttpErrorCode(new Error('not found'), 404)).toBe(false);
  });
});
