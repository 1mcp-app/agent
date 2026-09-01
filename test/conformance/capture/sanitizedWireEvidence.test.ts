import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createSanitizedWireCapture,
  SanitizedWireEvidenceFileSchema,
  serializeEvidence,
  writeEvidence,
} from './sanitizedWireEvidence.js';

describe('Sanitized Wire Evidence', () => {
  it('retains only allowlisted structural facts and uses the supplied validator', () => {
    const secret = 'Alpha-._~+/=Secret42';
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'case-http-01', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: (envelope) => envelope !== null && typeof envelope === 'object' && 'jsonrpc' in envelope,
    });

    capture.observe({
      contextId: 'case-http-01',
      hop: 'inbound',
      direction: 'client_to_gateway',
      headers: {
        authorization: `Bearer ${secret}`,
        cookie: `session=${secret}`,
        'content-type': 'application/json; charset=utf-8',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
        'x-oauth-client-metadata': `https://user.example/${secret}`,
      },
      body: Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: secret,
          method: 'tools/call',
          params: { arguments: { token: secret }, path: `/Users/person/${secret}` },
        }),
      ),
    });

    const evidence = capture.snapshot();
    expect(SanitizedWireEvidenceFileSchema.parse(evidence)).toEqual(evidence);
    expect(evidence.records).toHaveLength(1);
    expect(evidence.records[0]).toMatchObject({
      contextId: 'case-http-01',
      negotiatedRevision: '2025-11-25',
      hop: 'inbound',
      direction: 'client_to_gateway',
      method: 'tools_call',
      correlation: 'request',
      schemaResult: 'valid',
      contentKind: 'json',
      acceptKind: 'json_and_sse',
      envelope: {
        jsonrpc: true,
        id: true,
        method: true,
        params: true,
        result: false,
        error: false,
      },
    });
    expect(evidence.records[0].headers).toEqual([
      'accept',
      'authorization',
      'content_type',
      'cookie',
      'oauth_metadata',
      'protocol_revision',
    ]);

    const serialized = serializeEvidence(evidence);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('/Users/person');
    expect(serializeEvidence(evidence)).toBe(serialized);
  });

  it('maps invalid and throwing validators to closed result codes without leaking failures', () => {
    const secret = 'punctuation!@#$%^&*()secret';
    const invalid = createSanitizedWireCapture({
      contexts: [{ id: 'case-invalid', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: () => false,
    });
    invalid.observe({
      contextId: 'case-invalid',
      hop: 'upstream',
      direction: 'peer_to_gateway',
      headers: {},
      body: Buffer.from(`{"jsonrpc":"2.0","result":"${secret}","id":"${secret}"}`),
    });
    expect(invalid.snapshot().records[0].schemaResult).toBe('invalid');

    const throwing = createSanitizedWireCapture({
      contexts: [{ id: 'case-error', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: () => {
        throw new Error(`validator exploded: ${secret}`);
      },
    });
    throwing.observe({
      contextId: 'case-error',
      hop: 'upstream',
      direction: 'peer_to_gateway',
      headers: {},
      body: Buffer.from(`{"jsonrpc":"2.0","error":{"message":"${secret}"},"id":1}`),
    });
    const serialized = serializeEvidence(throwing.snapshot());
    expect(throwing.snapshot().records[0].schemaResult).toBe('infrastructure_error');
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('validator exploded');
  });

  it('classifies an empty transport response as having no applicable message schema', () => {
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'case-empty', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: () => false,
    });
    capture.observe({
      contextId: 'case-empty',
      hop: 'inbound',
      direction: 'gateway_to_client',
      headers: { 'content-type': 'application/json' },
      body: Buffer.alloc(0),
    });

    expect(capture.snapshot().records[0]).toMatchObject({ bodySize: 'empty', schemaResult: 'not_applicable' });
  });

  it('classifies a dropped oversized inspection buffer as an infrastructure error', () => {
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'case-truncated', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: () => true,
    });
    capture.observe({
      contextId: 'case-truncated',
      hop: 'upstream',
      direction: 'peer_to_gateway',
      headers: { 'content-type': 'application/json' },
      body: Buffer.alloc(0),
      bodyByteLength: 1_048_577,
      truncated: true,
    });

    expect(capture.snapshot().records[0]).toMatchObject({
      bodySize: 'oversize',
      schemaResult: 'infrastructure_error',
    });
  });

  it('produces stable canonical digests and rejects tampered or open-schema artifacts', () => {
    const makeEvidence = () => {
      const capture = createSanitizedWireCapture({
        contexts: [{ id: 'case-digest', negotiatedRevision: '2025-11-25' }],
        validateEnvelope: () => true,
      });
      capture.observe({
        contextId: 'case-digest',
        hop: 'inbound',
        direction: 'client_to_gateway',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"jsonrpc":"2.0","method":"ping","id":7}'),
      });
      return capture.snapshot();
    };

    const first = makeEvidence();
    const second = makeEvidence();
    expect(first.digest).toBe(second.digest);
    expect(first.records[0].digest).toBe(second.records[0].digest);
    expect(
      SanitizedWireEvidenceFileSchema.safeParse({
        ...first,
        records: [{ ...first.records[0], method: 'tools_call' }],
      }).success,
    ).toBe(false);
    expect(SanitizedWireEvidenceFileSchema.safeParse({ ...first, rawBody: 'forbidden' }).success).toBe(false);
  });

  it('does not disclose an untrusted context identifier in its failure string', () => {
    const secret = 'raw-context-secret!';
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'trusted-context', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: () => true,
    });
    expect(() =>
      capture.observe({
        contextId: secret,
        hop: 'inbound',
        direction: 'client_to_gateway',
        headers: {},
        body: Buffer.alloc(0),
      }),
    ).toThrow('Unregistered wire context');
    try {
      capture.observe({
        contextId: secret,
        hop: 'inbound',
        direction: 'client_to_gateway',
        headers: {},
        body: Buffer.alloc(0),
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('does not disclose a user path when persistence fails', async () => {
    const secret = 'SecretUserPath!';
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'case-path', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: () => true,
    });
    const base = await mkdtemp(join(tmpdir(), 'wire-path-'));
    try {
      const invalidPath = join(base, secret);
      await mkdir(invalidPath);

      let failure = '';
      try {
        await writeEvidence(invalidPath, capture.snapshot());
      } catch (error) {
        failure = String(error);
      }
      expect(failure).toContain('Evidence persistence failure');
      expect(failure).not.toContain(secret);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
