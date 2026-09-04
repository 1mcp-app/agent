import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { InvalidJsonValueError } from './jsonValue.js';
import { OneMcpProtocolError } from './oneMcpProtocolError.js';

describe('OneMcpProtocolError', () => {
  it('converts an actual v1 McpError to an owned plain-data error', () => {
    const foreignData = { retry: false, nested: ['legacy', 7] };
    const foreign = new McpError(-32_602, 'Invalid params', foreignData);
    Object.defineProperty(foreign, 'cause', { value: new Error('foreign cause') });

    const converted = OneMcpProtocolError.fromUnknown(foreign);

    expect(converted).toBeInstanceOf(OneMcpProtocolError);
    expect(converted).not.toBe(foreign);
    expect(converted).not.toBeInstanceOf(McpError);
    expect(converted).toMatchObject({ code: -32_602, message: 'MCP error -32602: Invalid params', data: foreignData });
    expect(converted.data).not.toBe(foreignData);
    expect('cause' in converted).toBe(false);
    expect(Object.getPrototypeOf(converted)).toBe(OneMcpProtocolError.prototype);
  });

  it('serializes predictably and returns a fresh data clone', () => {
    const error = new OneMcpProtocolError(-32_603, 'Internal error', { detail: 'safe' });
    const first = error.toJSON();
    const second = error.toJSON();

    expect(first).toEqual({ code: -32_603, message: 'Internal error', data: { detail: 'safe' } });
    expect(JSON.parse(JSON.stringify(error))).toEqual(first);
    expect(first.data).not.toBe(error.data);
    expect(second.data).not.toBe(first.data);
  });

  it('omits absent data from serialization', () => {
    const error = OneMcpProtocolError.fromUnknown(new McpError(-32_601, 'Method not found'));
    expect(error.toJSON()).toEqual({ code: -32_601, message: 'MCP error -32601: Method not found' });
  });

  it.each([Number.NaN, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid protocol error code %s',
    (code) => {
      expect(() => new OneMcpProtocolError(code, 'bad')).toThrow('safe integer');
    },
  );

  it('rejects non-string messages', () => {
    expect(() => OneMcpProtocolError.fromUnknown({ code: -1, message: 123 })).toThrow('message must be a string');
  });

  it('rejects invalid foreign error data instead of dropping it', () => {
    expect(() => OneMcpProtocolError.fromUnknown(new McpError(-1, 'bad data', { value: undefined }))).toThrowError(
      InvalidJsonValueError,
    );
  });

  it('rejects accessor-backed foreign data without invoking it', () => {
    const getter = vi.fn(() => ({ safe: true }));
    const foreign = Object.defineProperties(new Error('foreign'), {
      code: { enumerable: true, value: -1 },
      data: { enumerable: true, get: getter },
    });

    expect(() => OneMcpProtocolError.fromUnknown(foreign)).toThrow('data must be a data property');
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['code', 'message'])('rejects accessor-backed foreign %s without invoking it', (property) => {
    const getter = vi.fn(() => (property === 'code' ? -1 : 'foreign'));
    const foreign = Object.defineProperties(
      {},
      {
        code: { value: -1 },
        message: { value: 'foreign' },
        [property]: { configurable: true, get: getter },
      },
    );

    expect(() => OneMcpProtocolError.fromUnknown(foreign)).toThrow(`${property} must be a data property`);
    expect(getter).not.toHaveBeenCalled();
  });
});
