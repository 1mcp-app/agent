import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { resolveAsyncLoadingOptions } from '@src/commands/serve/asyncLoadingOptions.js';
import { serverOptions } from '@src/commands/serve/index.js';
import type { ServeOptions } from '@src/commands/serve/serve.js';
import { mergeGlobalAndServerConfig } from '@src/config/mcpConfigMerge.js';
import {
  getRuntimeParentEnvironment,
  installFrozenRuntimeBootstrap,
  releaseFrozenRuntimeBootstrap,
} from '@src/config/runtimeBootstrap.js';
import { loadRuntimeScopeEnvironment } from '@src/config/runtimeScopeEnv.js';
import { applicationConfigSchema, mcpServerConfigSchema, transportConfigSchema } from '@src/core/types/transport.js';
import { globalOptions } from '@src/globalOptions.js';

import { parse as parseToml } from 'smol-toml';
import yargs, { type Options } from 'yargs';
import { z } from 'zod';

const launchValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())]);
export const explicitLaunchInputsSchema = z
  .object({
    version: z.literal(1),
    values: z.record(z.string(), launchValueSchema),
  })
  .strict();
export type ExplicitLaunchInputs = z.infer<typeof explicitLaunchInputsSchema>;

const excludedOptions = new Set([
  'status',
  'background',
  'stop',
  'restart',
  'background-bootstrap',
  'runtime-owner-claim-id',
  'background-launch-config',
  'cooperative-bootstrap',
  'drain-timeout',
]);
const launchOptions: Record<string, Options> = Object.fromEntries(
  Object.entries({ ...globalOptions, ...serverOptions })
    .filter(([key]) => !excludedOptions.has(key))
    .map(([key, option]) => {
      const withoutDefault: Options = { ...option };
      delete withoutDefault.default;
      return [key, withoutDefault];
    }),
);

/** Reparse the original invocation with no defaults, retaining explicit ONE_MCP values too. */
export function captureExplicitLaunchInputs(rawArgv: string[]): ExplicitLaunchInputs {
  const parsed = yargs(rawArgv)
    .options(launchOptions)
    .env('ONE_MCP')
    .exitProcess(false)
    .fail(() => {
      throw new Error('Invalid explicit runtime launch options');
    })
    .help(false)
    .version(false)
    .parseSync();
  const values = Object.fromEntries(
    Object.keys(launchOptions)
      .filter((key) => parsed[key] !== undefined)
      .map((key) => [key, parsed[key]]),
  );
  for (const key of ['config', 'config-dir']) {
    if (typeof values[key] === 'string') values[key] = path.resolve(values[key]);
  }
  return validateExplicitInputs(explicitLaunchInputsSchema.parse({ version: 1, values }));
}

export const runtimeReplacementSnapshotSchema = z
  .object({
    version: z.literal(1),
    runtimeScope: z.string().min(1),
    configFilePath: z.string().min(1),
    mcpConfig: mcpServerConfigSchema,
    appConfig: applicationConfigSchema,
    runtimeEnvironment: z.record(z.string(), z.string()),
    parentEnvironment: z.record(z.string(), z.string()),
    explicitInputs: explicitLaunchInputsSchema,
  })
  .strict();
export type RuntimeReplacementSnapshot = z.infer<typeof runtimeReplacementSnapshotSchema>;

export interface PreparedRuntimeReplacementConfig {
  snapshot: RuntimeReplacementSnapshot;
  digest: string;
  effectiveOptions: Partial<ServeOptions>;
}

const authNumeric = applicationConfigSchema.shape.auth.unwrap().shape;
const explicitNumericOptionsSchema = z.object({
  port: applicationConfigSchema.shape.port,
  'session-ttl': authNumeric.sessionTtl,
  'rate-limit-window': authNumeric.rateLimitWindow,
  'rate-limit-max': authNumeric.rateLimitMax,
  'lazy-cache-max-entries': applicationConfigSchema.shape.lazyLoading.unwrap().shape.cacheMaxEntries,
  'config-reload-debounce': applicationConfigSchema.shape.configReload.unwrap().shape.debounce,
  'lazy-cache-ttl': z.number().int().nonnegative().optional(),
  'lazy-fallback-timeout': z.number().int().positive().optional(),
  'session-persist-requests': z.number().int().nonnegative().optional(),
  'session-persist-interval': z.number().nonnegative().optional(),
  'session-background-flush': z.number().nonnegative().optional(),
});

function validateExplicitInputs(input: ExplicitLaunchInputs): ExplicitLaunchInputs {
  const result = explicitLaunchInputsSchema.parse(input);
  for (const key of Object.keys(result.values)) {
    if (!Object.hasOwn(launchOptions, key)) throw new Error('Unsupported explicit runtime launch option');
    const option = launchOptions[key];
    const value = result.values[key];
    if (option.type && typeof value !== option.type) throw new Error('Invalid explicit runtime launch option');
    if (option.choices && !option.choices.includes(value as string))
      throw new Error('Invalid explicit runtime launch option');
  }
  explicitNumericOptionsSchema.parse(result.values);
  resolveAsyncLoadingOptions(result.values as Partial<ServeOptions>, undefined, () => undefined);
  return result;
}

/** Read current files once. Errors deliberately omit source text and secret-bearing values. */
export function prepareRuntimeReplacementConfig(input: {
  configFilePath: string;
  runtimeScope: string;
  previousExplicitInputs: ExplicitLaunchInputs;
  invocationExplicitInputs: ExplicitLaunchInputs;
}): PreparedRuntimeReplacementConfig {
  try {
    const previous = validateExplicitInputs(input.previousExplicitInputs);
    const invocation = validateExplicitInputs(input.invocationExplicitInputs);
    const explicitInputs = { version: 1 as const, values: { ...previous.values, ...invocation.values } };
    const explicitConfig = explicitInputs.values.config;
    const configFilePath = path.resolve(typeof explicitConfig === 'string' ? explicitConfig : input.configFilePath);
    const runtimeScope = path.resolve(input.runtimeScope);
    const canonicalScope = fs.realpathSync.native(runtimeScope);
    if (fs.realpathSync.native(path.dirname(configFilePath)) !== canonicalScope)
      throw new Error('Runtime scope mismatch');
    for (const values of [previous.values, invocation.values]) {
      if (
        typeof values.config === 'string' &&
        fs.realpathSync.native(path.dirname(path.resolve(values.config))) !== canonicalScope
      )
        throw new Error('Runtime config scope changed');
      if (
        typeof values['config-dir'] === 'string' &&
        fs.realpathSync.native(path.resolve(values['config-dir'])) !== canonicalScope
      )
        throw new Error('Runtime scope changed');
    }
    const tomlPath = path.join(path.dirname(configFilePath), 'config.toml');
    const mcpConfig = mcpServerConfigSchema.parse(JSON.parse(fs.readFileSync(configFilePath, 'utf8')));
    // Validate merged configurations as well as individual declared values.
    for (const config of Object.values({ ...mcpConfig.mcpServers, ...mcpConfig.mcpTemplates })) {
      transportConfigSchema.parse(mergeGlobalAndServerConfig(mcpConfig.serverDefaults, config));
    }
    let appConfig = {};
    try {
      appConfig = applicationConfigSchema.parse(parseToml(fs.readFileSync(tomlPath, 'utf8')));
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
    const snapshot = runtimeReplacementSnapshotSchema.parse({
      version: 1,
      runtimeScope,
      configFilePath,
      mcpConfig,
      appConfig,
      explicitInputs,
      runtimeEnvironment: loadRuntimeScopeEnvironment(configFilePath),
      parentEnvironment: Object.fromEntries(
        Object.entries(getRuntimeParentEnvironment()).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    });
    return {
      snapshot,
      digest: digestRuntimeReplacementConfig(snapshot),
      effectiveOptions: { ...explicitInputs.values } as Partial<ServeOptions>,
    };
  } catch {
    throw new Error(
      'Runtime replacement configuration is invalid; correct the selected scope configuration before retrying',
    );
  }
}

export function digestRuntimeReplacementConfig(snapshot: RuntimeReplacementSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

let installedDigest: string | undefined;

/** Call only on a private parent/child IPC payload, before any configuration managers initialize. */
export function installRuntimeReplacementConfig(
  input: unknown,
  expectedDigest: string,
  runtimeScope: string,
): RuntimeReplacementSnapshot {
  let snapshot: RuntimeReplacementSnapshot;
  try {
    snapshot = runtimeReplacementSnapshotSchema.parse(input);
  } catch {
    throw new Error('Invalid runtime replacement bootstrap');
  }
  if (
    snapshot.runtimeScope !== path.resolve(runtimeScope) ||
    snapshot.configFilePath !== path.resolve(snapshot.configFilePath)
  ) {
    throw new Error('Runtime replacement bootstrap scope mismatch');
  }
  if (digestRuntimeReplacementConfig(snapshot) !== expectedDigest)
    throw new Error('Runtime replacement bootstrap digest mismatch');
  validateExplicitInputs(snapshot.explicitInputs);
  installFrozenRuntimeBootstrap(snapshot);
  installedDigest = expectedDigest;
  return snapshot;
}

/** Release the frozen source only after the owning supervisor records activation. */
export function activateRuntimeReplacementConfig(expectedDigest: string): void {
  if (installedDigest !== expectedDigest) throw new Error('Runtime replacement activation digest mismatch');
  installedDigest = undefined;
  releaseFrozenRuntimeBootstrap();
}
