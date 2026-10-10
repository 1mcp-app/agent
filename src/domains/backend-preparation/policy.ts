import { z } from 'zod';

import type { BackendPolicy, PreparationOptions, PreparationTarget } from './contracts.js';

export const PreparationOptionsSchema = z
  .object({
    concurrency: z.number().int().min(1).max(64).default(1),
    queueCapacity: z.number().int().min(0).max(4096).default(16),
    requestWaitMs: z.number().int().min(0).max(3_600_000).default(5_000),
    executionDeadlineMs: z.number().int().min(1).max(86_400_000).default(120_000),
    maxRecords: z.number().int().min(1).max(100_000).default(1024),
  })
  .strict();

export const BackendPolicySchema = z
  .object({
    allowedActions: z.array(z.enum(['initialize', 'sync', 'rebuild', 'install', 'paid'])).max(5),
    executionDeadlineMs: z.number().int().min(1).max(86_400_000).optional(),
    transientRetryLimit: z.number().int().min(0).max(3).optional(),
  })
  .strict();

export const PreparationTargetSchema = z
  .object({
    checkoutRoot: z.string().min(1),
    backendName: z.string().min(1),
    backendIdentity: z.string().min(1),
    configurationKey: z.string().min(1),
  })
  .strict();

export function preparationKey(target: PreparationTarget, policy: BackendPolicy, options: PreparationOptions): string {
  return JSON.stringify([
    target.checkoutRoot,
    target.backendName,
    target.backendIdentity,
    target.configurationKey,
    [...new Set(policy.allowedActions)].sort(),
    policy.executionDeadlineMs ?? options.executionDeadlineMs,
    policy.transientRetryLimit ?? 0,
  ]);
}

export const PreparationFailureSchema = z
  .object({
    code: z.string().min(1).max(256),
    message: z.string().max(4096),
    retryable: z.boolean(),
    instructions: z.string().min(1).max(4096),
  })
  .strict();
