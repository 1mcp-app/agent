import { encode } from '@toon-format/toon';

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  formatToolCallOutput,
  RunCommandInputError,
  type RunOutputFormat,
  truncateText,
} from '@src/commands/run/runUtils.js';
import type { CallToolResult } from '@src/sdk/contracts/index.js';
import { secureNewPrivateEntry, verifyPrivateDirectory } from '@src/utils/security/privateFileSystem.js';

import { z } from 'zod';

const guidance =
  'Temporary file; use tools to filter or analyze selected fields without loading the entire file into context.';
const budgetSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

function formatReceipt(path: string, bytes: number, format: RunOutputFormat): string {
  const receipt = { artifact: 'temporary-json', path, bytes, guidance };
  if (format === 'json') return JSON.stringify(receipt, null, 2);
  if (format === 'toon') return encode(receipt);
  return `Temporary JSON artifact: ${path}\nBytes: ${bytes}\n${guidance}`;
}

export interface StdoutBudget {
  bytes: number;
  temporaryPrefix: string;
}

export function validateStdoutBudget(
  value: number | undefined,
  format: RunOutputFormat,
  spillDir?: string,
): StdoutBudget | undefined {
  if (value === undefined) {
    if (spillDir !== undefined) throw new RunCommandInputError('--spill-dir requires --spill-to-file-above-bytes.');
    return undefined;
  }
  const directory = z
    .string()
    .min(1)
    .refine((path) => !path.includes('\0'))
    .optional()
    .safeParse(spillDir);
  if (!directory.success)
    throw new RunCommandInputError('--spill-dir must be a non-empty directory path without null bytes.');
  const parsed = budgetSchema.safeParse(value);
  if (!parsed.success) throw new RunCommandInputError('--spill-to-file-above-bytes must be a positive safe integer.');
  const temporaryPrefix = join(resolve(spillDir ?? tmpdir()), '1mcp-result-');
  // mkdtemp appends six ASCII characters; reserve the largest possible JSON byte count before dispatch.
  const path = join(`${temporaryPrefix}XXXXXX`, 'result.json');
  const minimum = Buffer.byteLength(`${formatReceipt(path, Number.MAX_SAFE_INTEGER, format)}\n`, 'utf8');
  if (value < minimum) {
    throw new RunCommandInputError(
      `--spill-to-file-above-bytes must be at least ${minimum} bytes to fit a temporary artifact receipt.`,
    );
  }
  return { bytes: parsed.data, temporaryPrefix };
}

export async function prepareSpillDirectory(budget: StdoutBudget | undefined): Promise<void> {
  if (!budget) return;
  const directory = dirname(budget.temporaryPrefix);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await access(directory, constants.W_OK | constants.X_OK);
    // access() does not check Windows ACLs; create an empty probe without touching existing files.
    const probe = join(directory, `.1mcp-write-probe-${randomUUID()}`);
    const handle = await open(probe, 'wx', 0o600);
    try {
      await handle.close();
    } finally {
      await rm(probe);
    }
  } catch (cause) {
    throw new RunCommandInputError(
      `Cannot prepare spill directory ${directory}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export async function formatBudgetedToolOutput(
  result: CallToolResult,
  format: RunOutputFormat,
  maxChars: number,
  budget?: StdoutBudget,
): Promise<string> {
  const response = { jsonrpc: '2.0' as const, id: 0, result };
  if (!budget) return formatToolCallOutput(response, format, maxChars);
  const untruncated = formatToolCallOutput(response, format, 0);
  const emittedBytes = untruncated.length === 0 ? 0 : Buffer.byteLength(`${untruncated}\n`, 'utf8');
  if (emittedBytes <= budget.bytes) return formatToolCallOutput(response, format, maxChars);

  let directory: string | undefined;
  try {
    const json = JSON.stringify(result);
    const bytes = Buffer.byteLength(json, 'utf8');
    directory = await mkdtemp(budget.temporaryPrefix);
    await verifyPrivateDirectory(directory, { created: true });
    const path = join(directory, 'result.json');
    const receipt = formatReceipt(path, bytes, format);
    if (Buffer.byteLength(`${receipt}\n`, 'utf8') > budget.bytes)
      throw new Error('Artifact receipt exceeds stdout budget.');
    const handle = await open(path, 'wx', 0o600);
    try {
      await secureNewPrivateEntry(path, false);
      await handle.writeFile(json, 'utf8');
    } finally {
      await handle.close();
    }
    return receipt;
  } catch (cause) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    const reason = truncateText(
      (cause instanceof Error ? cause.message : String(cause)).replace(/[\r\n\t]/g, ' '),
      256,
    );
    throw new Error(
      `The upstream call completed, but local temporary artifact delivery failed (${reason}). No result was printed; inspect the tool outcome before retrying.`,
      { cause },
    );
  }
}
