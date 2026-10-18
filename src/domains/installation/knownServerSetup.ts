import { constants, readFileSync } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import ConfigContext from '@src/config/configContext.js';
import { getRuntimeParentEnvironment } from '@src/config/runtimeBootstrap.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import { transportConfigSchema } from '@src/core/types/transport.js';
import {
  type ConfigChangeResult,
  createConfigChangeService,
  type CreateStaticConfiguredServerTargetInput,
  type CreateTemplateConfiguredServerTargetInput,
  type EditConfiguredServerTargetInput,
  fingerprintConfiguredServerConfigDocument,
  fingerprintConfiguredServerDefaults,
  fingerprintConfiguredServerTarget,
} from '@src/domains/config-change/configChange.js';

import { z } from 'zod';

import { knownServerExamples } from './knownServerCatalog.js';
import type { KnownServerSetupInput, KnownServerSetupResult } from './knownServerSetupTypes.js';
import { isValidServerName } from './validators/serverNameValidator.js';

const checkoutMarker = '{{{project.path}}}';
const literalPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !/[${}]/u.test(value) &&
      [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
    {
      message: 'Use a literal path without control characters, environment references, or template markers.',
    },
  );
const absolutePath = literalPath.refine(path.isAbsolute, { message: 'Provide an absolute path.' });
const knownSourceSchema = z
  .object({
    type: z.literal('known'),
    exampleId: z.string().min(1),
    localName: z.string().refine(isValidServerName, { message: 'Invalid local server name.' }).optional(),
    executable: absolutePath.optional(),
    checkout: absolutePath.optional(),
  })
  .strict();

export interface KnownServerConfiguration {
  serverDefaults?: unknown;
  mcpServers?: Record<string, MCPServerParams>;
  mcpTemplates?: Record<string, MCPServerParams>;
}

export interface KnownServerSetupPorts {
  readConfiguration?: () => KnownServerConfiguration;
  resolveExecutable?: (executable: string) => Promise<string | undefined>;
  createStatic?: (input: CreateStaticConfiguredServerTargetInput) => Promise<ConfigChangeResult>;
  createTemplate?: (input: CreateTemplateConfiguredServerTargetInput) => Promise<ConfigChangeResult>;
  editTarget?: (input: EditConfiguredServerTargetInput) => Promise<ConfigChangeResult>;
}

function readKnownConfiguration(): KnownServerConfiguration {
  const configPath = ConfigContext.getInstance().getResolvedConfigPath();
  let content: string;
  try {
    content = readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { mcpServers: {} };
    throw error;
  }
  const server = z.custom<MCPServerParams>(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  return z
    .object({
      mcpServers: z.record(z.string(), server).optional(),
      mcpTemplates: z.record(z.string(), server).optional(),
    })
    .loose()
    .parse(JSON.parse(content));
}

export async function resolveKnownServerExecutable(executable: string): Promise<string | undefined> {
  if (!literalPath.safeParse(executable).success) return undefined;
  if (!path.isAbsolute(executable) && path.basename(executable) !== executable) return undefined;
  const candidates = path.isAbsolute(executable)
    ? [executable]
    : (getRuntimeParentEnvironment().PATH ?? '')
        .split(path.delimiter)
        .filter((directory) => path.isAbsolute(directory))
        .map((directory) => path.join(directory, executable));

  for (const candidate of candidates) {
    if (!absolutePath.safeParse(candidate).success) continue;
    try {
      await access(candidate, constants.X_OK);
      if (!(await stat(candidate)).isFile()) continue;
      const canonical = await realpath(candidate);
      if (!absolutePath.safeParse(canonical).success) continue;
      const launcher = path.join(await realpath(path.dirname(candidate)), path.basename(candidate));
      if (!absolutePath.safeParse(launcher).success) continue;
      return launcher;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function createKnownServerSetupWorkflow(ports: KnownServerSetupPorts = {}) {
  return {
    run: (input: KnownServerSetupInput): Promise<KnownServerSetupResult> => setupKnownServer(input, ports),
  };
}

export async function setupKnownServer(
  input: KnownServerSetupInput,
  ports: KnownServerSetupPorts = {},
): Promise<KnownServerSetupResult> {
  const base: KnownServerSetupResult = {
    status: 'invalid_input',
    mode: input.mode,
    sourceType: 'known',
    warnings: [],
  };
  const parsed = knownSourceSchema.safeParse(input.source);
  if (!parsed.success) {
    return { ...base, fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const expectedFingerprint = z.string().min(1).optional().safeParse(input.expectedSetupFingerprint);
  if (!expectedFingerprint.success) {
    return {
      ...base,
      fieldErrors: { expectedSetupFingerprint: ['Provide a nonempty setup fingerprint from preview.'] },
    };
  }
  const source = parsed.data;
  const example = knownServerExamples.find((entry) => entry.id === source.exampleId);
  if (!example) {
    return {
      ...base,
      status: 'not_found',
      error: `Unknown example '${source.exampleId}'. Choose ${knownServerExamples.map((entry) => entry.id).join(', ')}.`,
    };
  }

  const targetName = source.localName ?? example.id;
  const targetSource: 'mcpTemplates' | 'mcpServers' = source.checkout === undefined ? 'mcpTemplates' : 'mcpServers';
  const result: KnownServerSetupResult = {
    ...base,
    targetName,
    targetSource,
    exampleId: example.id,
    metadata: { localName: targetName },
    warnings: [
      'Automatic preparation is unsupported; setup does not establish native readiness.',
      'Executable identity does not establish backend version compatibility or operation-specific readiness.',
      ...example.nativeNextSteps,
    ],
  };
  try {
    const configuration = structuredClone((ports.readConfiguration ?? readKnownConfiguration)());
    const configurationFingerprint = fingerprintConfiguredServerConfigDocument(configuration);
    if (
      input.mode === 'apply' &&
      expectedFingerprint.data !== undefined &&
      !expectedFingerprint.data.startsWith(`${configurationFingerprint}.`)
    ) {
      return {
        ...result,
        status: 'setup_conflict',
        error: 'Known server setup changed after preview. Review a new preview before applying.',
      };
    }
    const otherSource = targetSource === 'mcpServers' ? 'mcpTemplates' : 'mcpServers';
    if (Object.hasOwn(configuration[otherSource] ?? {}, targetName)) {
      return {
        ...result,
        status: 'template_conflict',
        error: `Target '${targetName}' exists in ${otherSource}; setup cannot convert target sources, even with force.`,
      };
    }
    const existing = Object.hasOwn(configuration[targetSource] ?? {}, targetName)
      ? configuration[targetSource]?.[targetName]
      : undefined;
    const inheritedEnv = z
      .object({ env: z.unknown().optional() })
      .loose()
      .parse(configuration.serverDefaults ?? {}).env;
    let exampleEnv = Array.isArray(inheritedEnv) ? undefined : example.env;
    if (exampleEnv && inheritedEnv !== null && typeof inheritedEnv === 'object') {
      const missingDefaults = Object.entries(exampleEnv).filter(([key]) => !Object.hasOwn(inheritedEnv, key));
      exampleEnv = missingDefaults.length > 0 ? Object.fromEntries(missingDefaults) : undefined;
    }
    if (example.env && (Array.isArray(inheritedEnv) || Array.isArray(existing?.env))) {
      result.warnings.push(
        'Preserved array-form environment inheritance; example environment defaults are not added. Review native download and daemon settings before starting the backend.',
      );
    }
    const requestedExecutable = source.executable ?? existing?.command ?? example.executable;
    const executable = await (ports.resolveExecutable ?? resolveKnownServerExecutable)(requestedExecutable);
    if (!executable) {
      const error = `Executable '${requestedExecutable}' is missing or not executable. ${example.prerequisites.join(' ')} Supply --executable with an absolute launcher path.`;
      return {
        ...result,
        error,
        fieldErrors: { executable: [error] },
      };
    }
    if (!absolutePath.safeParse(executable).success) {
      const error = 'Resolved executable must be an absolute literal launcher path.';
      return { ...result, error, fieldErrors: { executable: [error] } };
    }
    let checkout = checkoutMarker;
    if (source.checkout !== undefined) {
      checkout = await realpath(source.checkout);
      if (!absolutePath.safeParse(checkout).success || !(await stat(checkout)).isDirectory()) {
        return { ...result, error: 'Checkout must resolve to a literal directory path.' };
      }
    }
    let config: MCPServerParams = {
      ...example.config,
      type: 'stdio',
      command: executable,
      args: example.args.map((argument) => (argument === checkoutMarker ? checkout : argument)),
      cwd: checkout,
      ...(exampleEnv ? { env: { ...exampleEnv } } : {}),
    };
    if (existing) {
      if (existing.type !== 'stdio' && existing.type !== undefined) {
        return { ...result, status: 'exists', error: 'Known setup cannot convert an existing non-stdio target.' };
      }
      if (targetSource === 'mcpTemplates') {
        const checkoutIndex = example.args.indexOf(checkoutMarker);
        if (existing.cwd !== checkoutMarker || existing.args?.[checkoutIndex] !== checkoutMarker) {
          return {
            ...result,
            error: `Existing template is not reusable: cwd and the checkout argument must both use ${checkoutMarker}. Reconfigure these explicit fields through the existing config edit workflow.`,
          };
        }
      }
      const compatible = existing.command === executable;
      if (!compatible && !input.force) {
        return {
          ...result,
          status: 'exists',
          error: `Target '${targetName}' has a different launch configuration. Use force to reconfigure it.`,
        };
      }
      config = {
        ...example.config,
        ...existing,
        ...(example.config?.template ? { template: { ...example.config.template, ...existing.template } } : {}),
        command: executable,
        ...(exampleEnv ? { env: Array.isArray(existing.env) ? existing.env : { ...exampleEnv, ...existing.env } } : {}),
      };
      const matchesLaunch = example.args.every(
        (argument, index) => argument === checkoutMarker || existing.args?.[index] === argument,
      );
      if (!matchesLaunch) {
        if (!input.force) {
          return {
            ...result,
            status: 'exists',
            error:
              'Existing custom launch arguments differ from the example. Use force to explicitly preserve this unverified custom launch configuration.',
          };
        }
        result.warnings.push('Preserved custom launch configuration is not a verified example recipe.');
      }
      if (source.checkout !== undefined) {
        const checkoutIndex = example.args.indexOf(checkoutMarker);
        if (!matchesLaunch || existing.args?.[checkoutIndex] === undefined) {
          return {
            ...result,
            error:
              'Existing custom launch arguments cannot be rebound safely. Reconfigure the target explicitly before changing its checkout.',
          };
        }
        const args = [...existing.args];
        args[checkoutIndex] = checkout;
        config = { ...config, args, cwd: checkout };
      }
    }
    const validated = transportConfigSchema.safeParse(config);
    if (!validated.success) {
      return {
        ...result,
        error: 'Candidate server configuration is invalid.',
        fieldErrors: z.flattenError(validated.error).fieldErrors,
      };
    }
    result.setupFingerprint = `${configurationFingerprint}.${fingerprintConfiguredServerConfigDocument({
      targetName,
      targetSource,
      exampleId: example.id,
      serverConfig: config,
    })}`;
    if (
      input.mode === 'apply' &&
      expectedFingerprint.data !== undefined &&
      expectedFingerprint.data !== result.setupFingerprint
    ) {
      return {
        ...result,
        status: 'setup_conflict',
        error: 'Known server setup changed after preview. Review a new preview before applying.',
      };
    }
    if (existing) {
      if (fingerprintConfiguredServerTarget(existing) === fingerprintConfiguredServerTarget(config)) {
        return { ...result, status: 'unchanged', config };
      }
      if (!input.force) {
        return {
          ...result,
          status: 'exists',
          config,
          error: `Target '${targetName}' already exists. Use force to reconfigure it.`,
        };
      }
    }
    if (input.mode === 'preview') return { ...result, status: 'preview', config };

    const service = createConfigChangeService();
    let change: ConfigChangeResult;
    if (existing) {
      change = await (ports.editTarget ?? service.editConfiguredServerTarget.bind(service))({
        sourceName: targetName,
        targetName,
        targetSource,
        serverConfig: config,
        expectedSourceFingerprint: fingerprintConfiguredServerTarget(existing),
        expectedGlobalConfigFingerprint: fingerprintConfiguredServerDefaults(configuration.serverDefaults),
      });
    } else {
      const create =
        targetSource === 'mcpTemplates'
          ? (ports.createTemplate ?? service.createTemplateConfiguredServerTarget.bind(service))
          : (ports.createStatic ?? service.createStaticConfiguredServerTarget.bind(service));
      change = await create({
        targetName,
        serverConfig: config,
        backup: input.backup ?? 'skip',
        expectedConfigFingerprint: configurationFingerprint,
      });
    }
    let status: KnownServerSetupResult['status'] = 'failed';
    if (change.status === 'changed') status = 'applied';
    if (change.status === 'unchanged') status = 'unchanged';
    if (change.status === 'destination_conflict') status = 'exists';
    if (change.status === 'template_conflict') status = 'template_conflict';
    return {
      ...result,
      status,
      config,
      configChange: change,
      warnings: [...result.warnings, ...change.warnings],
      error: change.error,
    };
  } catch {
    return {
      ...result,
      status: 'failed',
      error:
        'Known server setup failed. Check the executable, checkout directory, and configuration access; no dependency installation was attempted.',
    };
  }
}
