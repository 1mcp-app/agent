import type { RegistryServer } from '@src/domains/registry/types.js';

import type { ArgMetadata, EnvVarMetadata } from '../types.js';

/**
 * Extract all environment variables with metadata from server packages
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
 * Extract all runtime arguments with metadata from server packages
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
