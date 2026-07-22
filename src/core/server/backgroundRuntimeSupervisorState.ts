import fs from 'fs';
import path from 'path';

import { z } from 'zod';

export const BACKGROUND_SUPERVISOR_STATE_FILE = 'background-runtime.json';
export const BACKGROUND_MAX_RESTART_ATTEMPTS = 5;

export type BackgroundSupervisorStatus = 'starting' | 'running' | 'restarting' | 'crash-loop' | 'stopping';
export type BackgroundRuntimeSignal = string;

export interface BackgroundRuntimeExit {
  at: string;
  code: number | null;
  signal: BackgroundRuntimeSignal | null;
}

export interface BackgroundSupervisorState {
  version: 1;
  status: BackgroundSupervisorStatus;
  supervisorPid: number;
  runtimePid: number | null;
  restartAttempt: number;
  lastExit: BackgroundRuntimeExit | null;
  nextRetryAt: string | null;
  readyAt: string | null;
  updatedAt: string;
}

const stateSchema = z.object({
  version: z.literal(1),
  status: z.enum(['starting', 'running', 'restarting', 'crash-loop', 'stopping']),
  supervisorPid: z.number().int().positive(),
  runtimePid: z.number().int().positive().nullable(),
  restartAttempt: z.number().int().min(0).max(BACKGROUND_MAX_RESTART_ATTEMPTS),
  lastExit: z
    .object({
      at: z.string().datetime(),
      code: z.number().int().nullable(),
      signal: z.string().nullable(),
    })
    .nullable(),
  nextRetryAt: z.string().datetime().nullable(),
  readyAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

export class BackgroundSupervisorStateReadError extends Error {
  constructor(
    public readonly stateFilePath: string,
    cause: unknown,
  ) {
    super(
      `Background supervisor state is unreadable (${stateFilePath}): ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = 'BackgroundSupervisorStateReadError';
  }
}

export function getBackgroundSupervisorStatePath(configDir: string): string {
  return path.join(configDir, BACKGROUND_SUPERVISOR_STATE_FILE);
}

export function readBackgroundSupervisorState(configDir: string): BackgroundSupervisorState | null {
  const stateFilePath = getBackgroundSupervisorStatePath(configDir);
  let content: string;
  try {
    content = fs.readFileSync(stateFilePath, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return null;
    }
    throw new BackgroundSupervisorStateReadError(stateFilePath, error);
  }

  try {
    return stateSchema.parse(JSON.parse(content)) as BackgroundSupervisorState;
  } catch (error) {
    throw new BackgroundSupervisorStateReadError(stateFilePath, error);
  }
}

export function writeBackgroundSupervisorState(configDir: string, state: BackgroundSupervisorState): void {
  const stateFilePath = getBackgroundSupervisorStatePath(configDir);
  fs.mkdirSync(configDir, { recursive: true });
  const validated = stateSchema.parse(state);
  const tempFilePath = `${stateFilePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempFilePath, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempFilePath, stateFilePath);
}

export function cleanupBackgroundSupervisorState(configDir: string, supervisorPid: number): boolean {
  const current = readBackgroundSupervisorState(configDir);
  if (!current) {
    return true;
  }
  if (current.supervisorPid !== supervisorPid) {
    return false;
  }
  try {
    fs.unlinkSync(getBackgroundSupervisorStatePath(configDir));
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}
