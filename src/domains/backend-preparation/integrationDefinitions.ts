import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { builtInIntegrationDefinitions } from './builtInIntegrationDefinitions.js';
import {
  type ConfiguredCommandHelperSnapshot,
  ConfiguredCommandIntegrationSchema,
} from './configuredCommandAdapter.js';

const identitySchema = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/);
const inputNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,127}$/);
const reservedCommandMarkerPattern = /\{(?:checkout|operation|input:[^}]*)\}/;
const inputValueSchema = z
  .string()
  .min(1)
  .max(16384)
  .refine((value) => !value.includes('\0'), 'Input cannot contain NUL')
  .refine((value) => !reservedCommandMarkerPattern.test(value), 'Input contains a reserved command marker');
export const AffectedPreparationToolsSchema = z.union([
  z.literal('all'),
  z.array(z.string().min(1).max(256)).min(1).max(4096),
]);
export const IntegrationDefinitionSelectionSchema = z
  .object({
    id: identitySchema,
    file: z
      .string()
      .min(1)
      .max(4096)
      .refine(path.isAbsolute, 'Definition file must be an absolute local JSON path')
      .optional(),
    inputs: z.record(inputNameSchema, inputValueSchema).optional(),
  })
  .strict();
export const IntegrationDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identitySchema,
    revision: z.string().min(1).max(256),
    helperRevision: z.string().min(1).max(256),
    helperFiles: z.array(z.string().min(1).max(4096)).min(1).max(8).optional(),
    compatibility: z
      .object({
        backend: z.string().min(1).max(256),
        versions: z.array(z.string().min(1).max(256)).min(1).max(256),
        platforms: z
          .array(z.enum(['linux', 'darwin', 'win32']))
          .min(1)
          .max(3),
        readinessScope: z.string().min(1).max(4096),
      })
      .strict(),
    inputs: z.record(
      inputNameSchema,
      z.object({ required: z.boolean().optional(), default: inputValueSchema.optional() }).strict(),
    ),
    affectedTools: AffectedPreparationToolsSchema,
    integration: ConfiguredCommandIntegrationSchema,
  })
  .strict();
export type IntegrationDefinition = z.input<typeof IntegrationDefinitionSchema>;
export type IntegrationDefinitionSelection = z.infer<typeof IntegrationDefinitionSelectionSchema>;
export interface ResolvedIntegrationDefinition {
  readonly definition: z.output<typeof IntegrationDefinitionSchema>;
  readonly integration: z.output<typeof ConfiguredCommandIntegrationSchema>;
  readonly affectedTools: z.infer<typeof AffectedPreparationToolsSchema>;
  readonly revision: string;
  readonly helperSnapshots: readonly ConfiguredCommandHelperSnapshot[];
}

/** Read-only resolution from runtime-owned inputs. Never reads caller or project configuration. */
export function resolveIntegrationDefinition(
  selection: IntegrationDefinitionSelection,
  builtins: readonly IntegrationDefinition[] = builtInIntegrationDefinitions,
): ResolvedIntegrationDefinition {
  selection = IntegrationDefinitionSelectionSchema.parse(selection);
  const registry = new Map<string, z.output<typeof IntegrationDefinitionSchema>>();
  for (const candidate of builtins) {
    const definition = IntegrationDefinitionSchema.parse(candidate);
    if (registry.has(definition.id)) throw new Error(`Ambiguous integration definition identity: ${definition.id}`);
    registry.set(definition.id, definition);
  }
  let source: string | undefined;
  let definition: z.output<typeof IntegrationDefinitionSchema>;
  if (selection.file) {
    if (path.extname(selection.file) !== '.json') throw new Error('Definition file must be local JSON (.json)');
    source = fs.realpathSync(selection.file);
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new Error('Definition must be a JSON file no larger than 1 MiB');
    definition = IntegrationDefinitionSchema.parse(JSON.parse(fs.readFileSync(source, 'utf8')));
    if (registry.has(definition.id))
      throw new Error(`Local definition conflicts with built-in identity: ${definition.id}`);
  } else {
    const found = registry.get(selection.id);
    if (!found) throw new Error(`Unknown integration definition: ${selection.id}`);
    definition = found;
  }
  if (definition.id !== selection.id)
    throw new Error(`Definition identity does not match selected id: ${selection.id}`);
  if (!definition.compatibility.platforms.some((platform) => platform === process.platform)) {
    throw new Error(
      `Unsupported integration platform: ${process.platform}; supported: ${definition.compatibility.platforms.join(', ')}`,
    );
  }
  const inputs: Record<string, string> = {};
  for (const name of Object.keys(selection.inputs ?? {})) {
    if (!Object.hasOwn(definition.inputs, name)) throw new Error(`Unknown integration input: ${name}`);
  }
  for (const [name, declaration] of Object.entries(definition.inputs)) {
    const value = selection.inputs?.[name] ?? declaration.default;
    if (value === undefined) {
      if (declaration.required) throw new Error(`Missing required integration input: ${name}`);
      continue;
    }
    inputs[name] = value;
  }
  let helperBytes = 0;
  const helpers = (definition.helperFiles ?? []).map((file) => {
    if (reservedCommandMarkerPattern.test(file))
      throw new Error('Declared helper reference contains a reserved command marker');
    if (!path.isAbsolute(file) && !source) throw new Error('Built-in helper file paths must be absolute');
    const declaredPath = path.isAbsolute(file) ? path.normalize(file) : path.resolve(path.dirname(source!), file);
    const helper = fs.realpathSync(declaredPath);
    if (reservedCommandMarkerPattern.test(helper))
      throw new Error('Canonical helper path contains a reserved command marker');
    const stat = fs.statSync(helper);
    helperBytes += stat.size;
    if (!stat.isFile() || helperBytes > 1024 * 1024)
      throw new Error('Declared helpers must be local files totaling no more than 1 MiB');
    return {
      reference: file,
      declaredPath,
      path: helper,
      digest: createHash('sha256').update(fs.readFileSync(helper)).digest('hex'),
    };
  });
  const bindHelperReference = (value: string): string => {
    let candidate: string | undefined;
    if (path.isAbsolute(value)) candidate = path.normalize(value);
    else if (source) candidate = path.resolve(path.dirname(source), value);
    const helper = helpers.find(
      (item) => item.reference === value || item.declaredPath === candidate || item.path === candidate,
    );
    if (helper) return helper.path;
    const literal = value.replace(/\{input:[^}]+\}/g, '');
    for (const item of helpers) {
      const aliases = [
        item.reference,
        path.normalize(item.reference),
        item.declaredPath,
        item.path,
        path.basename(item.declaredPath),
        path.basename(item.path),
      ];
      if (source)
        aliases.push(
          path.relative(path.dirname(source), item.declaredPath),
          path.relative(path.dirname(source), item.path),
        );
      if (aliases.some((reference) => reference.length > 0 && literal.includes(reference))) {
        throw new Error(
          'Declared helper references must occupy a whole executable or argv argument; embedded references are unsupported',
        );
      }
    }
    return value;
  };
  const integration = structuredClone(definition.integration);
  const commands = [integration.probe, integration.status, ...Object.values(integration.actions)];
  for (const command of commands) {
    if (!command) continue;
    if (command.executable.includes('{')) throw new Error('Definition executable cannot contain placeholders');
    command.executable = bindHelperReference(command.executable);
    if (!path.isAbsolute(command.executable) && /[/\\]/.test(command.executable)) {
      if (!source) throw new Error('Built-in definition executable paths must be absolute');
      command.executable = path.resolve(path.dirname(source), command.executable);
    }
    command.args = command.args.map((argument) =>
      bindHelperReference(argument).replace(/\{input:([^}]+)\}/g, (_match, name: string) => {
        if (!Object.hasOwn(inputs, name)) throw new Error(`Missing integration input for command: ${name}`);
        return inputs[name];
      }),
    );
  }
  const validatedIntegration = ConfiguredCommandIntegrationSchema.parse(integration);
  const revision = createHash('sha256')
    .update(JSON.stringify({ definition, integration: validatedIntegration, inputs, source, helpers }))
    .digest('hex');
  return {
    definition,
    integration: validatedIntegration,
    affectedTools: definition.affectedTools,
    revision,
    helperSnapshots: helpers.map(({ path, digest }) => ({ path, digest })),
  };
}

export const PreparationConfigSchema = z
  .object({
    adapter: z.literal('configured-command'),
    affectedTools: AffectedPreparationToolsSchema.optional(),
    integration: ConfiguredCommandIntegrationSchema.optional(),
    definition: IntegrationDefinitionSelectionSchema.optional(),
    activation: z.literal('setup').optional(),
    enabled: z.boolean().optional(),
    allowedActions: z.array(z.enum(['initialize', 'sync', 'rebuild', 'install', 'paid'])).max(5),
    executionDeadlineMs: z.number().int().min(1).max(86_400_000).optional(),
    transientRetryLimit: z.number().int().min(0).max(3).optional(),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.definition && config.integration)
      context.addIssue({
        code: 'custom',
        path: ['definition'],
        message: 'Named definition and inline integration are mutually exclusive',
      });
    if (!config.definition && !config.affectedTools)
      context.addIssue({
        code: 'custom',
        path: ['affectedTools'],
        message: 'Inline preparation requires affectedTools',
      });
    if (config.activation && !config.definition)
      context.addIssue({
        code: 'custom',
        path: ['activation'],
        message: 'Setup activation requires an explicitly selected definition',
      });
  });
export type PreparationConfig = z.output<typeof PreparationConfigSchema>;
export type EffectivePreparationConfig = PreparationConfig & {
  affectedTools: z.infer<typeof AffectedPreparationToolsSchema>;
  effectiveRevision?: string;
  helperSnapshots?: readonly ConfiguredCommandHelperSnapshot[];
};

/** Validate setup/config changes without launching commands or applying configuration. */
export function validatePreparationConfig(
  config: unknown,
  builtins: readonly IntegrationDefinition[] = builtInIntegrationDefinitions,
): EffectivePreparationConfig {
  const parsed = PreparationConfigSchema.parse(config);
  if (!parsed.definition) return { ...parsed, affectedTools: parsed.affectedTools! };
  const resolved = resolveIntegrationDefinition(parsed.definition, builtins);
  if (parsed.affectedTools && JSON.stringify(parsed.affectedTools) !== JSON.stringify(resolved.affectedTools)) {
    throw new Error('Configured affectedTools conflicts with the selected definition');
  }
  return {
    ...parsed,
    integration: resolved.integration,
    affectedTools: resolved.affectedTools,
    effectiveRevision: resolved.revision,
    helperSnapshots: resolved.helperSnapshots,
  };
}
