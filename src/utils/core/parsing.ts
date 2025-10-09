import { InvalidRequestError } from './errorTypes.js';

/**
 * Extracts client name and resource name from a URI
 * Uses split with limit to handle separators in resource names correctly.
 * @param uri The URI to parse
 * @param separator The separator used in the URI
 * @returns An object with clientName and resourceName
 * @throws InvalidRequestError if the URI is invalid
 */
export function parseUri(uri: string, separator: string): { clientName: string; resourceName: string } {
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
