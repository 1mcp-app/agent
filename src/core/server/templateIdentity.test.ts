import { describe, expect, it } from 'vitest';

import {
  createRenderedIdentity,
  createSessionIdentity,
  createStaticIdentity,
  createTemplateLookupCandidates,
  parsePoolIdentity,
  parseTemplateConnectionKey,
  resolveTemplateIdentityMode,
  serializePoolIdentity,
  serializeTemplateIdentity,
  templateRenderedHash,
} from './templateIdentity.js';

describe('templateIdentity', () => {
  it('serializes static, rendered, session-bound, and pool identities', () => {
    expect(serializeTemplateIdentity(createStaticIdentity('filesystem'))).toBe('filesystem');
    expect(serializeTemplateIdentity(createRenderedIdentity('contextual', 'hash123'))).toBe('contextual:hash123');
    expect(serializeTemplateIdentity(createSessionIdentity('contextual', 'session-1'))).toBe('contextual:session-1');
    expect(serializePoolIdentity({ templateName: 'contextual', renderedHash: 'hash123' })).toBe('contextual:hash123');
    expect(serializePoolIdentity({ templateName: 'contextual', renderedHash: 'hash123', sessionId: 'session-1' })).toBe(
      'contextual:hash123:session-1',
    );
  });

  it('resolves session-bound mode for per-client and non-shareable templates', () => {
    expect(resolveTemplateIdentityMode({ perClient: true, shareable: true })).toBe('session');
    expect(resolveTemplateIdentityMode({ shareable: false })).toBe('session');
    expect(resolveTemplateIdentityMode({ shareable: true })).toBe('rendered');
    expect(resolveTemplateIdentityMode(undefined)).toBe('rendered');
  });

  it('creates deterministic rendered hashes from already-rendered configs', () => {
    const first = templateRenderedHash({ command: 'node', args: ['server.js'], env: { B: '2', A: '1' } });
    const second = templateRenderedHash({ env: { A: '1', B: '2' }, args: ['server.js'], command: 'node' });

    expect(first).toBe(second);
  });

  it('creates lookup candidates in session, rendered, static order', () => {
    const candidates = createTemplateLookupCandidates({
      templateName: 'contextual',
      sessionId: 'session-1',
      renderedHash: 'hash123',
    }).map(serializeTemplateIdentity);

    expect(candidates).toEqual(['contextual:session-1', 'contextual:hash123', 'contextual']);
  });

  it('rejects colon characters when constructing identities', () => {
    expect(() => createStaticIdentity('bad:name')).toThrow(/must not contain ':'/);
    expect(() => createRenderedIdentity('contextual', 'bad:hash')).toThrow(/must not contain ':'/);
    expect(() => createSessionIdentity('contextual', 'bad:session')).toThrow(/must not contain ':'/);
  });

  it('parses runtime map keys defensively', () => {
    expect(parseTemplateConnectionKey('filesystem')).toEqual(createStaticIdentity('filesystem'));
    expect(parseTemplateConnectionKey('contextual:hash123')).toEqual(createRenderedIdentity('contextual', 'hash123'));
    expect(parseTemplateConnectionKey('too:many:parts')).toEqual({ kind: 'invalid', key: 'too:many:parts' });
    expect(parseTemplateConnectionKey(':missing-name')).toEqual({ kind: 'invalid', key: ':missing-name' });
    expect(parseTemplateConnectionKey('missing-suffix:')).toEqual({ kind: 'invalid', key: 'missing-suffix:' });
  });

  it('parses pool identities separately from two-part routing keys', () => {
    expect(parsePoolIdentity('contextual:hash123')).toEqual({ templateName: 'contextual', renderedHash: 'hash123' });
    expect(parsePoolIdentity('contextual:hash123:session-1')).toEqual({
      templateName: 'contextual',
      renderedHash: 'hash123',
      sessionId: 'session-1',
    });
    expect(parsePoolIdentity('too:many:pool:parts')).toEqual({ kind: 'invalid', key: 'too:many:pool:parts' });
  });
});
