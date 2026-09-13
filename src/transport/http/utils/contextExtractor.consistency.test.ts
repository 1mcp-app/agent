import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { encodeContextValue, extractRequestContext, extractTemplateContextRequest } from './contextExtractor.js';

const context = { project: { cwd: '/project' }, user: {}, environment: {} };

describe('request context precedence', () => {
  it('rejects conflicting copies before selecting trusted request context', () => {
    const request = {
      body: { _meta: { context } },
      query: { context: encodeContextValue({ ...context, project: { cwd: '/other' } }) },
    } as unknown as Request;
    expect(() => extractRequestContext(request)).toThrow('Conflicting request context');
    expect(() => extractTemplateContextRequest(request)).toThrow('Conflicting request context');
  });
  it('accepts equal semantic context independent of object property ordering', () => {
    const request = {
      body: { _meta: { context } },
      query: { context: encodeContextValue({ environment: {}, user: {}, project: { cwd: '/project' } }) },
    } as unknown as Request;
    expect(extractRequestContext(request)).toEqual(context);
  });
  it('rejects conflicting REST and JSON-RPC body metadata', () => {
    const request = {
      body: { _meta: { context }, params: { _meta: { context: { ...context, project: { cwd: '/other' } } } } },
      query: {},
    } as unknown as Request;
    expect(() => extractTemplateContextRequest(request)).toThrow('Conflicting request context');
  });
});
