import type {
  RegistryInstallationSource,
  ServerInstallationWorkflowResult,
} from '@src/domains/installation/serverInstallationWorkflow.js';
import logger from '@src/logger/logger.js';

export function validateRegistryServerId(registryId: string): void {
  normalizeRegistryServerId(registryId);
}

function normalizeRegistryServerId(registryId: string): string {
  if (!registryId || registryId.trim().length === 0) {
    throw new Error('Registry server ID cannot be empty');
  }

  const trimmedId = registryId.trim();
  // eslint-disable-next-line no-control-regex
  const invalidChars = /[<>"\\|?*\x00-\x1f]/;
  if (invalidChars.test(trimmedId)) {
    throw new Error(`Registry server ID contains invalid characters: ${registryId}`);
  }

  if (trimmedId.length > 255) {
    throw new Error(`Registry server ID too long (max 255 characters): ${registryId}`);
  }

  if (trimmedId.includes('//') || trimmedId.startsWith('/') || trimmedId.endsWith('/')) {
    throw new Error(`Registry server ID has invalid format: ${registryId}`);
  }

  logger.debug(`Registry server ID validation passed: ${trimmedId}`);
  return trimmedId;
}

export function deriveLocalServerName(registryId: string): string {
  const lastPart = registryId.includes('/') ? registryId.split('/').pop()! : registryId;
  const localNameRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  if (localNameRegex.test(lastPart) && lastPart.length <= 50) {
    return lastPart;
  }

  let sanitized = lastPart.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = `server_${sanitized}`;
  }
  if (sanitized.length > 50) {
    sanitized = sanitized.substring(0, 50);
  }
  if (sanitized.length === 0) {
    sanitized = 'server';
  }

  logger.debug(`Derived local server name '${sanitized}' from registry ID '${registryId}'`);
  return sanitized;
}

export function installationWorkflowFailureMessage(result: ServerInstallationWorkflowResult): string {
  if (result.error) {
    return result.error;
  }

  if (result.fieldErrors) {
    const fieldErrorMessage = Object.entries(result.fieldErrors)
      .flatMap(([field, errors]) => errors.map((error) => `${field}: ${error}`))
      .join('; ');
    if (fieldErrorMessage) {
      return fieldErrorMessage;
    }
  }

  return `Installation workflow returned ${result.status}`;
}

export function createRegistryInstallSource(input: {
  registryServerId: string;
  version?: string;
  serverName: string;
  tags?: string[];
  env?: Record<string, string>;
  args?: string[];
}): RegistryInstallationSource {
  const registryId = normalizeRegistryServerId(input.registryServerId);
  return {
    type: 'registry',
    registryId,
    version: input.version,
    localName: input.serverName,
    tags: input.tags,
    env: input.env,
    args: input.args,
  };
}
