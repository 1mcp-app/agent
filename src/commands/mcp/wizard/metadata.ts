import { RegistryServer } from '@src/domains/registry/types.js';

/**
 * Metadata extraction utilities for MCP server installation
 */

/**
 * Environment variable metadata
 */
export interface EnvVarMetadata {
  key: string;
  description?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

/**
 * Runtime argument metadata
 */
export interface ArgMetadata {
  name?: string;
  description?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  type?: string;
  choices?: string[];
  valueHint?: string;
}

/**
 * Derive local server name from registry ID
 */
export function deriveLocalName(registryId: string): string {
  // Extract the last part after the slash, or use the full ID if no slash
  const lastPart = registryId.includes('/') ? registryId.split('/').pop()! : registryId;

  // If it already starts with a letter and only contains valid chars, use it as-is
  const localNameRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  if (localNameRegex.test(lastPart) && lastPart.length <= 50) {
    return lastPart;
  }

  // Otherwise, sanitize it
  let sanitized = lastPart.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Ensure it starts with a letter
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = `server_${sanitized}`;
  }

  // Truncate to 50 characters if longer
  if (sanitized.length > 50) {
    sanitized = sanitized.substring(0, 50);
  }

  // Ensure it's not empty after sanitization
  if (sanitized.length === 0) {
    sanitized = 'server';
  }

  return sanitized;
}

/**
 * Extract all environment variables with metadata from server
 */
export function extractEnvVarMetadata(server: RegistryServer): EnvVarMetadata[] {
  const envVars: EnvVarMetadata[] = [];
  const seen = new Set<string>();

  if (server.packages && server.packages.length > 0) {
    for (const pkg of server.packages) {
      if (pkg.environmentVariables && Array.isArray(pkg.environmentVariables)) {
        for (const envVar of pkg.environmentVariables) {
          // Use 'name' or 'value' field for the environment variable key
          const key = envVar.name || envVar.value;
          if (key && !seen.has(key)) {
            seen.add(key);
            envVars.push({
              key,
              description: envVar.description,
              default: envVar.default,
              isRequired: envVar.isRequired,
              isSecret: envVar.isSecret,
            });
          }
        }
      }
    }
  }

  return envVars;
}

/**
 * Extract default environment variables from server metadata
 */
export function extractDefaultEnvVars(server: RegistryServer): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Check packages for environment variables
  if (server.packages && server.packages.length > 0) {
    for (const pkg of server.packages) {
      if (pkg.environmentVariables && Array.isArray(pkg.environmentVariables)) {
        for (const envVar of pkg.environmentVariables) {
          if (envVar.value) {
            // Use the variable name from the value field or description
            const key = envVar.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            envVars[key] = envVar.default || '';
          }
        }
      }
    }
  }

  return envVars;
}

/**
 * Extract all runtime arguments with metadata from server
 */
export function extractArgMetadata(server: RegistryServer): ArgMetadata[] {
  const args: ArgMetadata[] = [];
  const seen = new Set<string>();

  if (server.packages && server.packages.length > 0) {
    for (const pkg of server.packages) {
      // Check both packageArguments and runtimeArguments
      const argSources = [...(pkg.packageArguments || []), ...(pkg.runtimeArguments || [])];

      for (const arg of argSources) {
        const name = arg.name;
        if (name && !seen.has(name)) {
          seen.add(name);
          args.push({
            name: arg.name,
            description: arg.description,
            default: arg.default,
            isRequired: arg.isRequired,
            isSecret: arg.isSecret,
            type: arg.type,
            choices: arg.choices,
            valueHint: arg.valueHint,
          });
        }
      }
    }
  }

  return args;
}

/**
 * Extract default arguments from server metadata
 */
export function extractDefaultArgs(server: RegistryServer): string[] {
  const args: string[] = [];

  // Check packages for runtime arguments
  if (server.packages && server.packages.length > 0) {
    for (const pkg of server.packages) {
      if (pkg.runtimeArguments && Array.isArray(pkg.runtimeArguments)) {
        for (const arg of pkg.runtimeArguments) {
          if (arg.default) {
            args.push(arg.default);
          }
        }
      }
    }
  }

  return args;
}
