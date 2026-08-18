import { createHmac, randomBytes } from 'node:crypto';

import type { MCPServerParams } from '@src/core/types/transport.js';

import { processEnvironment, substituteEnvVars } from './envProcessor.js';

const fingerprintKey = randomBytes(32);

export function createRuntimeTargetFingerprint(
  config: MCPServerParams,
  runtimeEnv: Readonly<Record<string, string>>,
  substituteEnv: boolean,
): string {
  const referenceEnvironment = { ...runtimeEnv, ...process.env };
  let effective: unknown;

  if (config.type === 'stdio' || (!config.type && config.command)) {
    const environment = processEnvironment({
      inheritParentEnv: config.inheritParentEnv,
      envFilter: config.envFilter,
      env: config.env,
      substituteEnv,
      runtimeEnv,
    }).processedEnv;
    const stdioReferenceEnvironment =
      config.envFilter && config.envFilter.length > 0 ? environment : { ...runtimeEnv, ...process.env, ...environment };
    effective = {
      ...config,
      command:
        substituteEnv && config.command ? substituteEnvVars(config.command, stdioReferenceEnvironment) : config.command,
      args: substituteEnv ? config.args?.map((arg) => substituteEnvVars(arg, stdioReferenceEnvironment)) : config.args,
      cwd: substituteEnv && config.cwd ? substituteEnvVars(config.cwd, stdioReferenceEnvironment) : config.cwd,
      env: environment,
    };
  } else if (substituteEnv) {
    effective = {
      ...config,
      url: config.url ? substituteEnvVars(config.url, referenceEnvironment) : config.url,
      headers: substituteRecord(config.headers, referenceEnvironment),
      oauth: config.oauth
        ? {
            ...config.oauth,
            clientId: substituteOptional(config.oauth.clientId, referenceEnvironment),
            clientSecret: substituteOptional(config.oauth.clientSecret, referenceEnvironment),
            redirectUrl: substituteOptional(config.oauth.redirectUrl, referenceEnvironment),
            scopes: config.oauth.scopes?.map((scope) => substituteEnvVars(scope, referenceEnvironment)),
          }
        : undefined,
    };
  } else {
    effective = config;
  }

  // This keyed, process-local digest detects config changes; it does not store or verify passwords.
  // codeql[js/insufficient-password-hash]
  return createHmac('sha256', fingerprintKey).update(stableStringify(effective)).digest('hex');
}

function substituteOptional(
  value: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return value ? substituteEnvVars(value, environment) : value;
}

function substituteRecord(
  values: Record<string, string> | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> | undefined {
  return values
    ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, substituteEnvVars(value, environment)]))
    : undefined;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
