import { createGatewayFailure } from '@src/gateway/contracts/gatewayFailure.js';
import type { JsonValue } from '@src/sdk/contracts/index.js';

export interface McpParamDeclaration {
  readonly path: readonly string[];
  readonly name: string;
  readonly type: 'string' | 'integer' | 'boolean';
}

export type McpParamScan =
  | { readonly valid: true; readonly declarations: readonly McpParamDeclaration[] }
  | { readonly valid: false; readonly reason: string };

const invalidHeaderTokenCharacter = /[^!#$%&'*+.^_`|~0-9A-Za-z-]/;
const excludedSubschemas = [
  'items',
  'prefixItems',
  'contains',
  'additionalItems',
  'contentSchema',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'propertyNames',
  'patternProperties',
  'dependentSchemas',
  'dependencies',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  '$defs',
  'definitions',
] as const;
const mappedSubschemas = new Set(['patternProperties', 'dependentSchemas', 'dependencies', '$defs', 'definitions']);

function record(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined;
  return value;
}

/** Scan only detached, budgeted catalog JSON. Never resolve a schema reference or read caller headers. */
export function scanMcpParamDeclarations(schema: JsonValue): McpParamScan {
  const declarations: McpParamDeclaration[] = [];
  const names = new Set<string>();
  const visit = (value: JsonValue, path: readonly string[], reachable: boolean): string | undefined => {
    const node = record(value);
    if (!node) return undefined;
    if (Object.hasOwn(node, 'x-mcp-header')) {
      if (!reachable || path.length === 0) return 'Annotation must be reachable through properties';
      const name = node['x-mcp-header'];
      if (typeof name !== 'string' || name.length === 0 || invalidHeaderTokenCharacter.test(name))
        return 'Header name must be an HTTP token';
      const type = node.type;
      if (type !== 'string' && type !== 'integer' && type !== 'boolean')
        return 'Header parameter must have type string, integer, or boolean';
      const normalized = name.toLowerCase();
      if (names.has(normalized)) return 'Header names must be case-insensitively unique';
      names.add(normalized);
      declarations.push({ path, name, type });
    }
    const properties = record(node.properties);
    for (const [name, child] of Object.entries(properties ?? {})) {
      const failure = visit(child, [...path, name], reachable);
      if (failure) return failure;
    }
    for (const keyword of excludedSubschemas) {
      const sub = node[keyword];
      if (sub === undefined) continue;
      let branches: readonly JsonValue[] = [sub];
      if (Array.isArray(sub)) branches = sub;
      else if (mappedSubschemas.has(keyword)) branches = Object.values(record(sub) ?? {});
      for (const branch of branches) {
        const failure = visit(branch, [], false);
        if (failure) return failure;
      }
    }
    return undefined;
  };
  const reason = visit(schema, [], true);
  return reason ? { valid: false, reason } : { valid: true, declarations };
}

function argumentAtPath(args: JsonValue | undefined, path: readonly string[]): JsonValue | undefined {
  let value = args;
  for (const name of path) {
    const parent = record(value);
    if (!parent || !Object.hasOwn(parent, name)) return undefined;
    value = parent[name];
  }
  return value;
}

function primitiveValue(value: JsonValue | undefined, type: McpParamDeclaration['type']): string | undefined {
  if (type === 'string') return typeof value === 'string' ? value : undefined;
  if (type === 'boolean') return typeof value === 'boolean' ? String(value) : undefined;
  if (typeof value !== 'number') return undefined;
  if (!Number.isSafeInteger(value))
    throw createGatewayFailure({
      kind: 'protocol',
      code: '-32602',
      message: 'Header integer parameter must be a safe integer',
    });
  return String(value);
}

function hasUnsafeFieldCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 9) continue;
    if (code < 32 || code > 126) return true;
  }
  return false;
}

function encodeValue(value: string): string {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    hasUnsafeFieldCharacter(value) ||
    (value.startsWith('=?base64?') && value.endsWith('?='))
  ) {
    return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }
  return value;
}

export function createMcpParamHeaders(
  declarations: readonly McpParamDeclaration[],
  args: JsonValue | undefined,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const declaration of declarations) {
    const value = primitiveValue(argumentAtPath(args, declaration.path), declaration.type);
    if (value !== undefined) headers[`Mcp-Param-${declaration.name}`] = encodeValue(value);
  }
  return headers;
}
