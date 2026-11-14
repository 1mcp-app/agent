import { HTTP_REQUEST_BODY_LIMIT } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { applicationConfigSchema } from '@src/core/types/transport.js';

import { describe, expect, it } from 'vitest';
import yargs from 'yargs';

import { serverOptions } from './index.js';

const ENV_KEY = 'ONE_MCP_HTTP_BODY_LIMIT';

function parse(args: string[], env: string | undefined) {
  const previous = process.env[ENV_KEY];
  if (env === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = env;
  try {
    return yargs(args).options(serverOptions).env('ONE_MCP').exitProcess(false).parseSync();
  } finally {
    if (previous === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previous;
  }
}

describe('HTTP request body limit configuration', () => {
  it('leaves the omitted setting unset so persisted configuration can supply it', () => {
    expect(parse([], undefined)['http-body-limit']).toBeUndefined();
    expect(applicationConfigSchema.parse({}).httpBodyLimit).toBeUndefined();
  });

  it('falls back to the body-parser default when nothing configures it', () => {
    expect(AgentConfigManager.getInstance().get('httpBodyLimit')).toBe(HTTP_REQUEST_BODY_LIMIT);
  });

  it('applies environment values and gives explicit CLI values precedence', () => {
    expect(parse([], '25mb')['http-body-limit']).toBe('25mb');
    expect(parse(['--http-body-limit', '5mb'], '25mb')['http-body-limit']).toBe('5mb');
  });

  it('reads the limit from persisted application configuration', () => {
    expect(applicationConfigSchema.parse({ httpBodyLimit: '25mb' }).httpBodyLimit).toBe('25mb');
    expect(applicationConfigSchema.parse({ httpBodyLimit: 26214400 }).httpBodyLimit).toBe(26214400);
  });

  it.each(['', 'large', '25 megabytes', '-1'])('rejects invalid persisted value %j', (value) => {
    expect(applicationConfigSchema.safeParse({ httpBodyLimit: value }).success).toBe(false);
  });

  it.each(['0', '-5'])('rejects non-positive byte counts %j', (value) => {
    expect(applicationConfigSchema.safeParse({ httpBodyLimit: Number(value) }).success).toBe(false);
  });
});
