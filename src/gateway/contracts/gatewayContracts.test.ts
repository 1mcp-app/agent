import { describe, expect, it } from 'vitest';

import {
  authorityAllows,
  classifyProtocolEra,
  createEffectiveRequestAuthority,
  createGatewayFailure,
  createGatewayRequestEnvelope,
  IndependentEraPins,
  narrowEffectiveRequestAuthority,
  toImmutableJsonValue,
} from './index.js';

describe('gateway contracts', () => {
  it('detaches and recursively freezes JSON boundary values', () => {
    const source = { nested: [{ value: 1 }] };
    const value = toImmutableJsonValue(source);

    source.nested[0].value = 2;
    expect(value).toEqual({ nested: [{ value: 1 }] });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen((value as { readonly nested: readonly unknown[] }).nested)).toBe(true);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it('rejects hidden state at every gateway plain-data boundary', () => {
    expect(() => toImmutableJsonValue(new (class Hidden {})())).toThrow(/only Object\.prototype/u);
    expect(() =>
      createGatewayFailure({ kind: 'internal', code: 'x', message: 'x', data: new Error('hidden') }),
    ).toThrow(/only Object\.prototype/u);
  });

  it('treats malformed modern evidence as terminal instead of legacy', () => {
    const result = classifyProtocolEra({ syntax: 'modern', revision: '2025-11-25' });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'modern_protocol_invalid', data: { observedEra: 'modern' } }),
    });
  });

  it('pins inbound and outbound eras independently and rejects later conflicts', () => {
    const pins = new IndependentEraPins();
    expect(pins.pin('inbound', { syntax: 'modern', revision: '2026-07-28' })).toMatchObject({
      ok: true,
      value: { era: 'modern' },
    });
    expect(pins.pin('outbound', { syntax: 'legacy', revision: '2025-11-25' })).toMatchObject({
      ok: true,
      value: { era: 'legacy' },
    });
    expect(pins.pin('inbound', { syntax: 'legacy', revision: '2025-11-25' })).toMatchObject({
      ok: false,
      failure: { code: 'protocol_era_pin_conflict' },
    });
    expect(pins.get('outbound')).toEqual({ era: 'legacy', revision: '2025-11-25' });
  });

  it('can only narrow effective authority', () => {
    const parent = createEffectiveRequestAuthority({ connectionIds: ['b', 'a', 'a'], provenance: ['tag:x'] });
    const narrowed = narrowEffectiveRequestAuthority(parent, ['b', 'outside'], ['preset:y']);

    expect(parent.connectionIds).toEqual(['a', 'b']);
    expect(narrowed).toEqual({ connectionIds: ['b'], provenance: ['preset:y', 'tag:x'] });
    expect(authorityAllows(narrowed, 'outside')).toBe(false);
    expect(Object.isFrozen(narrowed.connectionIds)).toBe(true);
  });

  it('freezes a complete SDK-free request envelope', () => {
    const authority = { connectionIds: ['backend'], provenance: [] };
    const inbound: { era: 'modern'; revision: string } = { era: 'modern', revision: '2026-07-28' };
    const envelope = createGatewayRequestEnvelope({
      requestId: 'request-1',
      operation: 'tools/list',
      targetConnectionId: 'backend',
      params: { cursor: 'next' },
      authority,
      inbound,
      outbound: Object.freeze({ era: 'legacy', revision: '2025-11-25' }),
      deadlineUnixMs: 10_000,
    });

    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.params)).toBe(true);
    expect(Object.isFrozen(envelope.authority.connectionIds)).toBe(true);
    expect(Object.isFrozen(envelope.inbound)).toBe(true);
    authority.connectionIds.push('outside');
    inbound.revision = '2025-11-25';
    expect(envelope.authority.connectionIds).toEqual(['backend']);
    expect(envelope.inbound.revision).toBe('2026-07-28');
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
  });

  it('allowlists envelope and pin fields instead of retaining hidden state', () => {
    const symbol = Symbol('hidden');
    const input = {
      requestId: 'request-1',
      operation: 'tools/list' as const,
      targetConnectionId: 'backend',
      authority: createEffectiveRequestAuthority({ connectionIds: ['backend'] }),
      inbound: { era: 'legacy' as const, revision: '2025-11-25', session: new Error('hidden') },
      outbound: { era: 'modern' as const, revision: '2026-07-28', callback: () => undefined },
      deadlineUnixMs: 10_000,
      session: new Error('hidden'),
      [symbol]: new Error('hidden'),
    };

    const envelope = createGatewayRequestEnvelope(input);
    expect(Reflect.ownKeys(envelope)).toEqual([
      'requestId',
      'operation',
      'targetConnectionId',
      'authority',
      'inbound',
      'outbound',
      'deadlineUnixMs',
    ]);
    expect(Reflect.ownKeys(envelope.inbound)).toEqual(['era', 'revision']);
    expect(Reflect.ownKeys(envelope.outbound)).toEqual(['era', 'revision']);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
  });
});
