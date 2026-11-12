import { applicationConfigSchema, transportConfigSchema } from '@src/core/types/transport.js';

import { describe, expect, it } from 'vitest';
import yargs from 'yargs';
import { z } from 'zod';

import { serverOptions } from './index.js';

function parse(args: string[], env: string | undefined) {
  const previous = process.env.ONE_MCP_INBOUND_HTTP_ERA;
  if (env === undefined) delete process.env.ONE_MCP_INBOUND_HTTP_ERA;
  else process.env.ONE_MCP_INBOUND_HTTP_ERA = env;
  try {
    return yargs(args).options(serverOptions).env('ONE_MCP').exitProcess(false).parseSync();
  } finally {
    if (previous === undefined) delete process.env.ONE_MCP_INBOUND_HTTP_ERA;
    else process.env.ONE_MCP_INBOUND_HTTP_ERA = previous;
  }
}

describe('inbound HTTP era configuration', () => {
  it('leaves the omitted setting unset so persisted configuration can supply it', () => {
    expect(parse([], undefined)['inbound-http-era']).toBeUndefined();
    expect(applicationConfigSchema.parse({}).inboundHttpEra).toBeUndefined();
  });
  it('applies environment values and gives explicit CLI values precedence', () => {
    expect(parse([], 'legacy-only')['inbound-http-era']).toBe('legacy-only');
    expect(parse(['--inbound-http-era', 'dual'], 'legacy-only')['inbound-http-era']).toBe('dual');
  });
  it.each(['modern', 'legacy', '', 'false'])('rejects invalid value %j at each boundary', (value) => {
    expect(() => parse(['--inbound-http-era', value], undefined)).toThrow();
    expect(() => parse([], value)).toThrow();
    expect(applicationConfigSchema.safeParse({ inboundHttpEra: value }).success).toBe(false);
  });
  it('generates the two-value schema and keeps outbound protocolVersion independent', () => {
    expect(z.toJSONSchema(applicationConfigSchema).properties?.inboundHttpEra).toMatchObject({
      enum: ['dual', 'legacy-only'],
    });
    expect(applicationConfigSchema.parse({ inboundHttpEra: 'legacy-only' })).toEqual({ inboundHttpEra: 'legacy-only' });
    expect(
      transportConfigSchema.parse({ type: 'http', url: 'http://127.0.0.1/mcp', protocolVersion: '2026-07-28' })
        .protocolVersion,
    ).toBe('2026-07-28');
  });
});
