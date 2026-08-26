import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { z } from 'zod';

const ContextIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const RevisionSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u);

export const WireHopSchema = z.enum(['inbound', 'upstream', 'stdio']);
export const WireDirectionSchema = z.enum([
  'client_to_gateway',
  'gateway_to_client',
  'gateway_to_peer',
  'peer_to_gateway',
]);
export const WireMethodSchema = z.enum([
  'none',
  'initialize',
  'initialized',
  'ping',
  'tools_list',
  'tools_call',
  'resources_list',
  'resources_read',
  'resources_subscribe',
  'resources_unsubscribe',
  'prompts_list',
  'prompts_get',
  'logging_set_level',
  'completion_complete',
  'cancelled',
  'progress',
  'other',
]);
export const HeaderCodeSchema = z.enum([
  'accept',
  'authorization',
  'content_type',
  'cookie',
  'oauth_metadata',
  'protocol_revision',
  'session',
]);
export const BodySizeSchema = z.enum(['empty', 'tiny', 'small', 'medium', 'large', 'oversize']);
export const ContentKindSchema = z.enum(['absent', 'json', 'sse', 'text', 'binary', 'other']);
export const AcceptKindSchema = z.enum(['absent', 'json', 'sse', 'json_and_sse', 'other']);
export const SchemaResultSchema = z.enum(['valid', 'invalid', 'infrastructure_error', 'not_applicable']);
export const CorrelationKindSchema = z.enum(['request', 'notification', 'response', 'error', 'unknown']);

export const EnvelopePresenceSchema = z
  .object({
    jsonrpc: z.boolean(),
    id: z.boolean(),
    method: z.boolean(),
    params: z.boolean(),
    result: z.boolean(),
    error: z.boolean(),
  })
  .strict();

const SanitizedWireRecordFactsSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    contextId: ContextIdSchema,
    negotiatedRevision: RevisionSchema,
    hop: WireHopSchema,
    direction: WireDirectionSchema,
    method: WireMethodSchema,
    headers: z.array(HeaderCodeSchema).max(7),
    bodySize: BodySizeSchema,
    contentKind: ContentKindSchema,
    acceptKind: AcceptKindSchema,
    envelope: EnvelopePresenceSchema,
    correlation: CorrelationKindSchema,
    schemaResult: SchemaResultSchema,
  })
  .strict();

export const SanitizedWireRecordSchema = SanitizedWireRecordFactsSchema.extend({
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).superRefine((record, context) => {
  const { digest: actualDigest, ...facts } = record;
  if (actualDigest !== digest(facts)) {
    context.addIssue({ code: 'custom', path: ['digest'], message: 'Record digest mismatch' });
  }
});

export const SanitizedWireEvidenceFileSchema = z
  .object({
    schemaVersion: z.literal('1'),
    records: z.array(SanitizedWireRecordSchema),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict()
  .superRefine((evidence, context) => {
    const { digest: actualDigest, ...content } = evidence;
    if (actualDigest !== digest(content)) {
      context.addIssue({ code: 'custom', path: ['digest'], message: 'Evidence digest mismatch' });
    }
  });

export type WireHop = z.infer<typeof WireHopSchema>;
export type WireDirection = z.infer<typeof WireDirectionSchema>;
export type SanitizedWireRecord = z.infer<typeof SanitizedWireRecordSchema>;
export type SanitizedWireEvidenceFile = z.infer<typeof SanitizedWireEvidenceFileSchema>;

export interface TrustedWireContext {
  id: string;
  negotiatedRevision: string;
}

export interface RawWireObservation {
  contextId: string;
  hop: WireHop;
  direction: WireDirection;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
  bodyByteLength?: number;
}

export type EnvelopeValidator = (envelope: Record<string, unknown>) => boolean;

export interface SanitizedWireCapture {
  observe(observation: RawWireObservation): SanitizedWireRecord;
  snapshot(): SanitizedWireEvidenceFile;
}

const METHOD_CODES = new Map<string, z.infer<typeof WireMethodSchema>>([
  ['initialize', 'initialize'],
  ['notifications/initialized', 'initialized'],
  ['ping', 'ping'],
  ['tools/list', 'tools_list'],
  ['tools/call', 'tools_call'],
  ['resources/list', 'resources_list'],
  ['resources/read', 'resources_read'],
  ['resources/subscribe', 'resources_subscribe'],
  ['resources/unsubscribe', 'resources_unsubscribe'],
  ['prompts/list', 'prompts_list'],
  ['prompts/get', 'prompts_get'],
  ['logging/setLevel', 'logging_set_level'],
  ['completion/complete', 'completion_complete'],
  ['notifications/cancelled', 'cancelled'],
  ['notifications/progress', 'progress'],
]);

const HEADER_CODES = new Map<string, z.infer<typeof HeaderCodeSchema>>([
  ['accept', 'accept'],
  ['authorization', 'authorization'],
  ['content-type', 'content_type'],
  ['cookie', 'cookie'],
  ['mcp-protocol-version', 'protocol_revision'],
  ['mcp-session-id', 'session'],
  ['x-oauth-client-metadata', 'oauth_metadata'],
]);

const EMPTY_ENVELOPE = {
  jsonrpc: false,
  id: false,
  method: false,
  params: false,
  result: false,
  error: false,
} as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function bodySize(length: number): z.infer<typeof BodySizeSchema> {
  if (length === 0) return 'empty';
  if (length <= 256) return 'tiny';
  if (length <= 4_096) return 'small';
  if (length <= 65_536) return 'medium';
  if (length <= 1_048_576) return 'large';
  return 'oversize';
}

function headerValue(headers: RawWireObservation['headers'], name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return Array.isArray(value) ? value.join(',') : value;
}

function presentHeaderCodes(headers: RawWireObservation['headers']): z.infer<typeof HeaderCodeSchema>[] {
  const codes = new Set<z.infer<typeof HeaderCodeSchema>>();
  for (const name of Object.keys(headers)) {
    const code = HEADER_CODES.get(name.toLowerCase());
    if (code) codes.add(code);
  }
  return [...codes].sort();
}

function contentKind(headers: RawWireObservation['headers']): z.infer<typeof ContentKindSchema> {
  const value = headerValue(headers, 'content-type')?.toLowerCase();
  if (!value) return 'absent';
  if (value.includes('application/json')) return 'json';
  if (value.includes('text/event-stream')) return 'sse';
  if (value.startsWith('text/')) return 'text';
  if (value.includes('octet-stream')) return 'binary';
  return 'other';
}

function acceptKind(headers: RawWireObservation['headers']): z.infer<typeof AcceptKindSchema> {
  const value = headerValue(headers, 'accept')?.toLowerCase();
  if (!value) return 'absent';
  const json = value.includes('application/json');
  const sse = value.includes('text/event-stream');
  if (json && sse) return 'json_and_sse';
  if (json) return 'json';
  if (sse) return 'sse';
  return 'other';
}

function parseEnvelope(body: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function envelopePresence(envelope: Record<string, unknown> | null) {
  if (!envelope) return { ...EMPTY_ENVELOPE };
  return {
    jsonrpc: Object.hasOwn(envelope, 'jsonrpc'),
    id: Object.hasOwn(envelope, 'id'),
    method: Object.hasOwn(envelope, 'method'),
    params: Object.hasOwn(envelope, 'params'),
    result: Object.hasOwn(envelope, 'result'),
    error: Object.hasOwn(envelope, 'error'),
  };
}

function correlation(envelope: Record<string, unknown> | null): z.infer<typeof CorrelationKindSchema> {
  if (!envelope) return 'unknown';
  if (Object.hasOwn(envelope, 'method')) {
    return Object.hasOwn(envelope, 'id') ? 'request' : 'notification';
  }
  if (Object.hasOwn(envelope, 'error')) return 'error';
  if (Object.hasOwn(envelope, 'result')) return 'response';
  return 'unknown';
}

function methodCode(envelope: Record<string, unknown> | null): z.infer<typeof WireMethodSchema> {
  if (!envelope || !Object.hasOwn(envelope, 'method')) return 'none';
  return typeof envelope.method === 'string' ? (METHOD_CODES.get(envelope.method) ?? 'other') : 'other';
}

export function createSanitizedWireCapture(options: {
  contexts: readonly TrustedWireContext[];
  validateEnvelope: EnvelopeValidator;
}): SanitizedWireCapture {
  const contexts = new Map<string, string>();
  for (const context of options.contexts) {
    const parsed = z.object({ id: ContextIdSchema, negotiatedRevision: RevisionSchema }).strict().safeParse(context);
    if (!parsed.success || contexts.has(parsed.data.id)) {
      throw new Error('Invalid trusted wire context registration');
    }
    contexts.set(parsed.data.id, parsed.data.negotiatedRevision);
  }

  const records: SanitizedWireRecord[] = [];
  return {
    observe(observation) {
      const negotiatedRevision = contexts.get(observation.contextId);
      if (!negotiatedRevision) throw new Error('Unregistered wire context');
      const route = z
        .object({ hop: WireHopSchema, direction: WireDirectionSchema })
        .strict()
        .safeParse({ hop: observation.hop, direction: observation.direction });
      if (!route.success) throw new Error('Invalid wire observation routing');

      const kind = contentKind(observation.headers);
      const envelope = kind === 'json' || kind === 'absent' ? parseEnvelope(observation.body) : null;
      let schemaResult: z.infer<typeof SchemaResultSchema> = 'not_applicable';
      if (kind === 'json' || kind === 'absent') {
        if (!envelope) {
          schemaResult = 'invalid';
        } else {
          try {
            schemaResult = options.validateEnvelope(envelope) ? 'valid' : 'invalid';
          } catch {
            schemaResult = 'infrastructure_error';
          }
        }
      }

      const facts = {
        sequence: records.length,
        contextId: observation.contextId,
        negotiatedRevision,
        hop: route.data.hop,
        direction: route.data.direction,
        method: methodCode(envelope),
        headers: presentHeaderCodes(observation.headers),
        bodySize: bodySize(observation.bodyByteLength ?? observation.body.byteLength),
        contentKind: kind,
        acceptKind: acceptKind(observation.headers),
        envelope: envelopePresence(envelope),
        correlation: correlation(envelope),
        schemaResult,
      };
      const record = SanitizedWireRecordSchema.parse({ ...facts, digest: digest(facts) });
      records.push(record);
      return record;
    },
    snapshot() {
      const snapshot = { schemaVersion: '1' as const, records: records.map((record) => ({ ...record })) };
      return SanitizedWireEvidenceFileSchema.parse({ ...snapshot, digest: digest(snapshot) });
    },
  };
}

export function serializeEvidence(evidence: SanitizedWireEvidenceFile): string {
  return `${canonicalJson(SanitizedWireEvidenceFileSchema.parse(evidence))}\n`;
}

export async function writeEvidence(path: string, evidence: SanitizedWireEvidenceFile): Promise<void> {
  try {
    await writeFile(path, serializeEvidence(evidence), { encoding: 'utf8', mode: 0o600 });
  } catch {
    throw new Error('Evidence persistence failure');
  }
}
