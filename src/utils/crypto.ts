import { randomBytes, scryptSync } from 'crypto';

const runtimeHashSalt = randomBytes(32);

/**
 * Creates a process-local password-hard hash of the given string.
 *
 * Callers use this for runtime identity and cache comparison, which can include
 * rendered credentials. A keyed digest keeps those values resistant to offline
 * guessing while remaining deterministic for the lifetime of the process.
 */
export function createHash(data: string): string {
  return scryptSync(data, runtimeHashSalt, 32).toString('hex');
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
