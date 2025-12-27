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
