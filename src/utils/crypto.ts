import { createHash as cryptoCreateHash } from 'crypto';

/**
 * Creates a SHA-256 hash of the given string
 */
export function createHash(data: string): string {
  return cryptoCreateHash('sha256').update(data).digest('hex');
}

/**
 * Creates a hash for comparing template variables
 * Uses deterministic sorting to ensure consistent hashing
 */
export function createVariableHash(variables: Record<string, unknown>): string {
  const sortedKeys = Object.keys(variables).sort();
  const hashObject: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    hashObject[key] = variables[key];
  }

  return createHash(JSON.stringify(hashObject));
}
