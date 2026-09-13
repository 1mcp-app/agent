import { Server, specTypeSchemas } from '@modelcontextprotocol/server';

import { SchemaBoundaryError } from '@src/core/validation/schemaPolicy.js';
import { type JsonObject, toJsonValue } from '@src/sdk/contracts/index.js';
import type { Server as LegacyServer } from '@src/sdk/legacy/server/index.js';
import { Protocol } from '@src/sdk/legacy/shared/protocol.js';

/** Pinned v2 codec owns reversible wrapping and reference rebasing. No copied codec algorithm. */
class LegacySchemaCodec extends Server {
  constructor() {
    super({ name: '1mcp-schema-projection', version: '1' }, { capabilities: { tools: {} } });
  }
  projectTools(result: JsonObject): JsonObject {
    return toJsonValue(this._wireCodec().encodeResult('tools/list', result)) as JsonObject;
  }
}
// An unconnected v2 Server explicitly uses its legacy codec until negotiation.
const codec = new LegacySchemaCodec();
export function projectLegacyTools(result: JsonObject): JsonObject {
  return codec.projectTools(result);
}
export function projectLegacyToolResult(result: unknown, outputSchema?: Readonly<Record<string, unknown>>): JsonObject {
  assertCanonicalToolResult(result);
  return toJsonValue(
    codec.projectCallToolResult(result as Parameters<Server['projectCallToolResult']>[0], outputSchema),
  ) as JsonObject;
}

export function projectCanonicalToolResult(
  result: unknown,
  outputSchema?: Readonly<Record<string, unknown>>,
): JsonObject {
  const canonical = toJsonValue(result) as JsonObject;
  const projected = projectLegacyToolResult(canonical, outputSchema);
  return {
    ...projected,
    ...(Object.hasOwn(canonical, 'structuredContent') ? { structuredContent: canonical.structuredContent } : {}),
  };
}

/** Only the trusted modern bridge may avoid v1's object-only result-shape wrapper.
 * Our schema boundary and the official modern result schema remain mandatory.
 */
export function canonicalBridgeToolRegistrar(server: LegacyServer): LegacyServer['setRequestHandler'] {
  return Protocol.prototype.setRequestHandler.bind(server) as LegacyServer['setRequestHandler'];
}

export function assertCanonicalToolResult(result: unknown): void {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    ('resultType' in result && result.resultType !== 'complete') ||
    specTypeSchemas.CallToolResult['~standard'].validate({ resultType: 'complete', ...result }).issues !== undefined
  )
    throw new SchemaBoundaryError('schema_output_invalid');
}
