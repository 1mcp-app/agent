import { z } from 'zod';

import { ConfiguredCommandError, runConfiguredCommand } from './configuredCommandProcess.js';
import type {
  BackendPreparationAdapter,
  BackendReadiness,
  PreparationAction,
  PreparationFailure,
  PreparationProgress,
  PreparationRecoveryHint,
  PreparationTarget,
} from './contracts.js';

const actionSchema = z.enum(['initialize', 'sync', 'rebuild', 'install', 'paid']);
const commandSchema = z
  .object({ executable: z.string().min(1).max(4096), args: z.array(z.string().max(16384)).max(256) })
  .strict();
const mappingSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready') }).strict(),
  z.object({ state: z.literal('required'), action: actionSchema, instructions: z.string().min(1).max(4096) }).strict(),
  z.object({ state: z.literal('conflict'), instructions: z.string().min(1).max(4096) }).strict(),
]);
export const ConfiguredCommandIntegrationSchema = z
  .object({
    containment: z.literal('posix-process-group'),
    probe: commandSchema,
    status: commandSchema.optional(),
    readinessExitCodes: z.record(z.string().regex(/^(?:0|[1-9]\d?|1\d{2}|2[0-4]\d|25[0-5])$/), mappingSchema),
    actions: z.partialRecord(
      actionSchema,
      commandSchema
        .extend({
          successExitCodes: z.array(z.number().int().min(0).max(255)).min(1).default([0]),
          transientExitCodes: z.array(z.number().int().min(0).max(255)).default([]),
        })
        .strict()
        .refine(
          (command) => !command.transientExitCodes.some((code) => command.successExitCodes.includes(code)),
          'Success and transient exit codes cannot overlap',
        ),
    ),
    inspectionTimeoutMs: z.number().int().min(1).max(60000).default(5000),
    outputLimitBytes: z.number().int().min(256).max(65536).default(16384),
    terminationGraceMs: z.number().int().min(1).max(5000).default(500),
  })
  .strict();
export type ConfiguredCommandIntegration = z.input<typeof ConfiguredCommandIntegrationSchema>;

export const PreparationProgressSchema = z
  .object({
    message: z.string().max(4096).optional(),
    completed: z.number().finite().nonnegative().optional(),
    total: z.number().finite().positive().optional(),
    unit: z.string().max(128).optional(),
  })
  .strict()
  .refine(
    (progress) =>
      progress.completed === undefined || progress.total === undefined || progress.completed <= progress.total,
    'Completed progress exceeds total',
  );

export class ConfiguredCommandPreparationAdapter implements BackendPreparationAdapter {
  private readonly integration: z.output<typeof ConfiguredCommandIntegrationSchema>;
  constructor(integration: ConfiguredCommandIntegration) {
    this.integration = ConfiguredCommandIntegrationSchema.parse(integration);
  }
  async inspect(
    target: PreparationTarget,
    operation: string,
    options: { signal?: AbortSignal; waitMs?: number } = {},
  ): Promise<BackendReadiness> {
    if (options.waitMs === 0)
      return {
        state: 'unknown',
        reason: 'inspection_timeout',
        instructions: 'No inspection budget remains; no command was launched.',
      };
    try {
      const result = await runConfiguredCommand(this.integration.probe, {
        checkoutRoot: target.checkoutRoot,
        operation,
        signal: options.signal,
        deadlineMs: Math.min(
          options.waitMs ?? this.integration.inspectionTimeoutMs,
          this.integration.inspectionTimeoutMs,
        ),
        outputLimitBytes: this.integration.outputLimitBytes,
        terminationGraceMs: this.integration.terminationGraceMs,
      });
      const mapping = this.integration.readinessExitCodes[String(result.code)];
      if (!mapping)
        return {
          state: 'unknown',
          reason: 'unmapped_exit',
          instructions: `Unmapped readiness exit ${result.code}; configure an explicit readiness mapping.`,
        };
      if (mapping.state === 'conflict') return mapping;
      const evidence = {
        freshness: 'unknown' as const,
        coverage: 'unknown' as const,
        detail: (result.output.trim() || result.diagnostic.trim() || `Configured probe exited ${result.code}.`).slice(
          0,
          4096,
        ),
      };
      return { ...mapping, evidence };
    } catch (error) {
      const failure = this.classifyFailure(error);
      if (failure.code === 'unsupported_containment') return { state: 'unsupported', instructions: failure.message };
      let reason: 'caller_disconnected' | 'inspection_timeout' | 'probe_failed' = 'probe_failed';
      if (options.signal?.aborted) reason = 'caller_disconnected';
      else if (failure.code === 'execution_deadline') reason = 'inspection_timeout';
      return {
        state: 'unknown',
        reason,
        instructions: `Read-only probe could not establish readiness: ${failure.message}`,
      };
    }
  }
  async prepare(
    target: PreparationTarget,
    action: PreparationAction,
    options: { signal: AbortSignal; executionDeadlineMs: number; operation?: string },
  ): Promise<void> {
    const command = this.integration.actions[action];
    if (!command) throw new ConfiguredCommandError('unsupported_action', `No configured command supports ${action}.`);
    const result = await runConfiguredCommand(command, {
      checkoutRoot: target.checkoutRoot,
      operation: options.operation ?? '',
      signal: options.signal,
      deadlineMs: options.executionDeadlineMs,
      outputLimitBytes: this.integration.outputLimitBytes,
      terminationGraceMs: this.integration.terminationGraceMs,
    });
    if (!command.successExitCodes.includes(result.code))
      throw new ConfiguredCommandError(
        'command_exit',
        `Configured ${action} exited ${result.code}: ${result.diagnostic || result.output}`,
        command.transientExitCodes.includes(result.code),
      );
  }
  async progress(
    target: PreparationTarget,
    operation: string,
    options: { signal?: AbortSignal; waitMs?: number } = {},
  ): Promise<PreparationProgress | undefined> {
    if (!this.integration.status || options.waitMs === 0) return undefined;
    try {
      const result = await runConfiguredCommand(this.integration.status, {
        checkoutRoot: target.checkoutRoot,
        operation,
        signal: options.signal,
        deadlineMs: Math.min(
          options.waitMs ?? this.integration.inspectionTimeoutMs,
          this.integration.inspectionTimeoutMs,
        ),
        outputLimitBytes: this.integration.outputLimitBytes,
        terminationGraceMs: this.integration.terminationGraceMs,
      });
      if (result.code !== 0) return undefined;
      const progress = PreparationProgressSchema.safeParse(JSON.parse(result.output));
      return progress.success ? progress.data : undefined;
    } catch {
      return undefined;
    }
  }
  async reconcile(
    target: PreparationTarget,
    operation: string,
    advisory: PreparationRecoveryHint,
    options: { signal?: AbortSignal; waitMs?: number } = {},
  ): Promise<BackendReadiness> {
    if (['queued', 'running', 'cancelling'].includes(advisory.previousState))
      return {
        state: 'conflict',
        instructions:
          'Previous runtime ownership is uncertain. Reconcile native writer ownership externally before explicit preparation; saved job state confers no process ownership.',
      };
    return this.inspect(target, operation, options);
  }
  classifyFailure(error: unknown): PreparationFailure {
    const code = error instanceof ConfiguredCommandError ? error.code : 'command_failed';
    return {
      code,
      message: error instanceof Error ? error.message : String(error),
      retryable: error instanceof ConfiguredCommandError && error.retryable,
      instructions:
        'Inspect the configured command and native writer ownership before explicit retry. Deadline exhaustion requires a larger explicit execution budget.',
    };
  }
}
