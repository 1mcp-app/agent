import type { RegistryServer } from '@src/domains/registry/types.js';

/**
 * Extract default environment variables from server metadata
 * @deprecated Use extractEnvVarMetadata and filter for defaults instead
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
 * Extract default arguments from server metadata
 * @deprecated Use extractArgMetadata and filter for defaults instead
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
