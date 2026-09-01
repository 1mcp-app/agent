import { CallToolRequestSchema as V2CallToolRequestSchema } from '@modelcontextprotocol/core';

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { McpError, CallToolRequestSchema as V1CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { z } from 'zod';

import {
  InvalidJsonValueError,
  isJsonValue,
  type JsonValue,
  toJsonValue,
} from '../../../src/sdk/contracts/jsonValue.js';
import { OneMcpProtocolError } from '../../../src/sdk/contracts/oneMcpProtocolError.js';

const ARTIFACT_ID = 'boundary/sdk-boundary-proof.json';
const CHECK_IDS = [
  'sdk-boundary.v1-request-accepted',
  'sdk-boundary.v2-request-accepted',
  'sdk-boundary.v1-schema-rejected',
  'sdk-boundary.v2-schema-rejected',
  'sdk-boundary.non-json-rejected',
  'sdk-boundary.v1-error-converted',
  'sdk-boundary.foreign-prototypes-removed',
  'sdk-boundary.output-is-json',
] as const;

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const packageIdentitySchema = z
  .object({
    name: z.enum(['@modelcontextprotocol/core', '@modelcontextprotocol/sdk']),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u),
  })
  .strict();
const checkSchema = z.object({ id: z.enum(CHECK_IDS), status: z.enum(['passed', 'failed']) }).strict();
const sdkBoundaryProofPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    attempt: z.literal(1),
    classification: z.literal('product'),
    productVerdict: z.enum(['pass', 'fail']),
    packageIdentities: z.tuple([packageIdentitySchema, packageIdentitySchema]),
    topologyDigest: digestSchema,
    checks: z.array(checkSchema).length(CHECK_IDS.length),
  })
  .strict()
  .superRefine((proof, context) => {
    const observedIds = proof.checks.map((check) => check.id);
    if (new Set(observedIds).size !== CHECK_IDS.length || CHECK_IDS.some((id) => !observedIds.includes(id))) {
      context.addIssue({ code: 'custom', message: 'SDK boundary proof check set is incomplete' });
    }
    const expectedVerdict = proof.checks.every((check) => check.status === 'passed') ? 'pass' : 'fail';
    if (proof.productVerdict !== expectedVerdict) {
      context.addIssue({ code: 'custom', message: 'SDK boundary proof verdict does not match its checks' });
    }
    if (
      proof.packageIdentities[0].name !== '@modelcontextprotocol/core' ||
      proof.packageIdentities[1].name !== '@modelcontextprotocol/sdk'
    ) {
      context.addIssue({ code: 'custom', message: 'SDK boundary proof package identities are out of order' });
    }
  });

export const sdkBoundaryProofArtifactSchema = sdkBoundaryProofPayloadSchema
  .extend({ evidenceDigest: digestSchema })
  .strict();

export type SdkBoundaryProofResult =
  | {
      classification: 'product';
      productVerdict: 'pass' | 'fail';
      artifactId: typeof ARTIFACT_ID;
      evidenceDigest: `sha256:${string}`;
      attempt: 1;
    }
  | {
      classification: 'fixture' | 'harness';
      reason: 'fixture-crash' | 'proof-missing' | 'proof-malformed' | 'proof-digest-mismatch';
      attempt: 1;
    };

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function payloadDigest(payload: z.infer<typeof sdkBoundaryProofPayloadSchema>): `sha256:${string}` {
  return digest(JSON.stringify(canonicalize(payload)));
}

async function packageVersion(root: string, packageName: string): Promise<string> {
  const manifest = z
    .object({ name: z.literal(packageName), version: z.string() })
    .passthrough()
    .parse(JSON.parse(await readFile(join(root, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8')));
  return manifest.version;
}

function status(value: boolean): 'passed' | 'failed' {
  return value ? 'passed' : 'failed';
}

export async function generateSdkBoundaryProof(root: string, outputDirectory: string): Promise<SdkBoundaryProofResult> {
  try {
    const request = { method: 'tools/call', params: { name: 'boundary-proof', arguments: { accepted: true } } };
    const v1Request = V1CallToolRequestSchema.safeParse(request);
    const v2Request = V2CallToolRequestSchema.safeParse(request);
    let v1Json: JsonValue | undefined;
    let v2Json: JsonValue | undefined;
    if (v1Request.success) {
      try {
        v1Json = toJsonValue(v1Request.data);
      } catch (error) {
        if (!(error instanceof InvalidJsonValueError)) throw error;
      }
    }
    if (v2Request.success) {
      try {
        v2Json = toJsonValue(v2Request.data);
      } catch (error) {
        if (!(error instanceof InvalidJsonValueError)) throw error;
      }
    }
    let convertedError: OneMcpProtocolError | undefined;
    try {
      convertedError = OneMcpProtocolError.fromUnknown(new McpError(-32_602, 'Invalid params', { retry: false }));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    const rejects = (value: unknown): boolean => {
      try {
        toJsonValue(value);
        return false;
      } catch (error) {
        if (error instanceof InvalidJsonValueError) return true;
        throw error;
      }
    };
    const checks = [
      { id: CHECK_IDS[0], status: status(v1Json !== undefined && isJsonValue(v1Json)) },
      { id: CHECK_IDS[1], status: status(v2Json !== undefined && isJsonValue(v2Json)) },
      { id: CHECK_IDS[2], status: status(rejects(V1CallToolRequestSchema)) },
      { id: CHECK_IDS[3], status: status(rejects(V2CallToolRequestSchema)) },
      { id: CHECK_IDS[4], status: status(rejects(undefined) && rejects(1n)) },
      {
        id: CHECK_IDS[5],
        status: status(
          convertedError?.code === -32_602 &&
            convertedError.message === 'MCP error -32602: Invalid params' &&
            !(convertedError instanceof McpError),
        ),
      },
      {
        id: CHECK_IDS[6],
        status: status(
          v1Json !== undefined &&
            v2Json !== undefined &&
            convertedError?.data !== undefined &&
            Object.getPrototypeOf(v1Json) === Object.prototype &&
            Object.getPrototypeOf(v2Json) === Object.prototype &&
            Object.getPrototypeOf(convertedError.data) === Object.prototype,
        ),
      },
      {
        id: CHECK_IDS[7],
        status: status(
          v1Json !== undefined &&
            v2Json !== undefined &&
            convertedError !== undefined &&
            isJsonValue(v1Json) &&
            isJsonValue(v2Json) &&
            isJsonValue(convertedError.toJSON()),
        ),
      },
    ];
    const topology = await readFile(join(root, 'test/sdk-boundary/sdk-topology.snapshot.json'), 'utf8');
    const payload = sdkBoundaryProofPayloadSchema.parse({
      schemaVersion: 1,
      attempt: 1,
      classification: 'product',
      productVerdict: checks.every((check) => check.status === 'passed') ? 'pass' : 'fail',
      packageIdentities: [
        { name: '@modelcontextprotocol/core', version: await packageVersion(root, '@modelcontextprotocol/core') },
        { name: '@modelcontextprotocol/sdk', version: await packageVersion(root, '@modelcontextprotocol/sdk') },
      ],
      topologyDigest: digest(topology),
      checks,
    });
    const evidenceDigest = payloadDigest(payload);
    const artifact = sdkBoundaryProofArtifactSchema.parse({ ...payload, evidenceDigest });
    await mkdir(join(outputDirectory, 'boundary'), { recursive: true, mode: 0o700 });
    await writeFile(join(outputDirectory, ARTIFACT_ID), `${JSON.stringify(artifact, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return {
      classification: 'product',
      productVerdict: artifact.productVerdict,
      artifactId: ARTIFACT_ID,
      evidenceDigest,
      attempt: 1,
    };
  } catch {
    return { classification: 'fixture', reason: 'fixture-crash', attempt: 1 };
  }
}

export async function readSdkBoundaryProof(
  outputDirectory: string,
  reference: { evidenceDigest: string },
): Promise<SdkBoundaryProofResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(outputDirectory, ARTIFACT_ID), 'utf8'));
  } catch (error) {
    return {
      classification: 'harness',
      reason: error instanceof SyntaxError ? 'proof-malformed' : 'proof-missing',
      attempt: 1,
    };
  }
  const artifact = sdkBoundaryProofArtifactSchema.safeParse(raw);
  if (!artifact.success) return { classification: 'harness', reason: 'proof-malformed', attempt: 1 };
  const { evidenceDigest, ...payload } = artifact.data;
  if (evidenceDigest !== payloadDigest(payload) || evidenceDigest !== reference.evidenceDigest) {
    return { classification: 'harness', reason: 'proof-digest-mismatch', attempt: 1 };
  }
  return {
    classification: 'product',
    productVerdict: artifact.data.productVerdict,
    artifactId: ARTIFACT_ID,
    evidenceDigest,
    attempt: 1,
  };
}
