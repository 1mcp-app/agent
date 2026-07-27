import { describe, expect, it } from 'vitest';

import {
  AmbiguousTemplateInstanceIdError,
  createRenderedIdentity,
  createSessionIdentity,
  createStaticIdentity,
  createTemplateInstanceId,
  createTemplateLookupCandidates,
  formatTemplateInstanceId,
  parsePoolIdentity,
  parseTemplateConnectionKey,
  resolveTemplateIdentityMode,
  resolveTemplateInstanceId,
  serializePoolIdentity,
  serializeTemplateIdentity,
  templateRenderedHash,
} from './templateIdentity.js';

const FIRST_INSTANCE_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SECOND_INSTANCE_ID = '0fedcba9876543210fedcba9876543210fedcba9876543210fedcba987654321';

describe('templateIdentity', () => {
  it('creates opaque canonical template instance IDs with 12-character display IDs', () => {
    const first = createTemplateInstanceId();
    const second = createTemplateInstanceId();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(formatTemplateInstanceId(FIRST_INSTANCE_ID)).toBe('0123456789ab');
  });

  it('resolves full template instance IDs and unique prefixes', () => {
    const instanceIds = [FIRST_INSTANCE_ID, SECOND_INSTANCE_ID];

    expect(resolveTemplateInstanceId(FIRST_INSTANCE_ID, instanceIds)).toBe(FIRST_INSTANCE_ID);
    expect(resolveTemplateInstanceId('0123456789ab', instanceIds)).toBe(FIRST_INSTANCE_ID);
    expect(resolveTemplateInstanceId('f', instanceIds)).toBeUndefined();
  });

  it('rejects ambiguous prefixes with the matching short display IDs', () => {
    const first = `0a${FIRST_INSTANCE_ID.slice(2)}`;
    const second = `0b${SECOND_INSTANCE_ID.slice(2)}`;

    expect(() => resolveTemplateInstanceId('0', [second, first])).toThrow(
      new AmbiguousTemplateInstanceIdError('0', [formatTemplateInstanceId(first), formatTemplateInstanceId(second)]),
    );
  });

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
