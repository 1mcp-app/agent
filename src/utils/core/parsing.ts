import { createHash } from 'node:crypto';

import { MCP_URI_SEPARATOR } from '@src/constants/mcp.js';

import { InvalidRequestError } from './errorTypes.js';

/**
 * Result of parsing a URI into its components
 */
export interface UriParts {
  clientName: string;
  resourceName: string;
}

/**
 * Extracts client name and resource name from a URI
 * Uses split with limit to handle separators in resource names correctly.
 * @param uri The URI to parse
 * @param separator The separator used in the URI
 * @returns An object with clientName and resourceName
 * @throws InvalidRequestError if the URI is invalid
 */
export function parseUri(uri: string, separator: string): UriParts {
  if (typeof uri !== 'string' || !uri?.trim()) {
    throw new InvalidRequestError('URI must be a non-empty string');
  }

  if (!separator || typeof separator !== 'string') {
    throw new InvalidRequestError('Separator must be a non-empty string');
  }

  // Split only on the first occurrence of separator
  const parts = uri.split(separator, 2);

  if (parts.length < 2 || !uri.includes(separator)) {
    throw new InvalidRequestError(`Invalid URI format: missing separator '${separator}' in '${uri}'`);
  }

  const clientName = parts[0].trim();
  const resourceName = uri.substring(parts[0].length + separator.length).trim();

  if (!clientName) {
    throw new InvalidRequestError('Client name cannot be empty');
  }

  if (!resourceName) {
    throw new InvalidRequestError('Resource name cannot be empty');
  }

  return { clientName, resourceName };
}

/**
 * Builds a URI by combining client name and resource name with a separator
 * @param clientName The client name
 * @param resourceName The resource name
 * @param separator The separator to use between client and resource names
 * @returns The constructed URI
 */
export function buildUri(clientName: string, resourceName: string, separator: string): string {
  if (!clientName?.trim()) {
    throw new InvalidRequestError('Client name cannot be empty');
  }

  if (!resourceName?.trim()) {
    throw new InvalidRequestError('Resource name cannot be empty');
  }

  if (!separator || typeof separator !== 'string') {
    throw new InvalidRequestError('Separator must be a non-empty string');
  }

  return `${clientName.trim()}${separator}${resourceName.trim()}`;
}

/** Preserve valid public names; compact names that exceed MCP's tool-name limits. */
export function buildToolName(serverName: string, toolName: string): string {
  const qualified = buildUri(serverName, toolName, MCP_URI_SEPARATOR);
  if (qualified.length <= 64 && /^[A-Za-z0-9_./-]+$/.test(qualified)) return qualified;

  // Hash the structured source tuple, not an ambiguous concatenated identity.
  // Connection IDs and catalog generations must not change consumer references.
  const digest = createHash('sha256')
    .update(JSON.stringify([serverName.trim(), toolName.trim()]))
    .digest('hex')
    .slice(0, 40);
  const serverPrefix = serverName
    .trim()
    .replace(/[^A-Za-z0-9_./-]/g, '_')
    .slice(0, 18);
  return `${serverPrefix}${MCP_URI_SEPARATOR}${digest}`;
}
