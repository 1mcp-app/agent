import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Readable } from 'node:stream';

import { getRuntimeParentEnvironment } from '@src/config/runtimeBootstrap.js';
import { renderManagedDocContent } from '@src/core/instructions/instructionsDistribution.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { isSea } from 'node:sea';
import { z } from 'zod';

export const BOOTSTRAP_INPUT_LIMIT = 64 * 1024;
export const BOOTSTRAP_CONTEXT_LIMIT = 9000;
export const BOOTSTRAP_DEADLINE_MS = 5000;
const RUNTIME_OUTPUT_LIMIT = 32 * 1024;
export const bootstrapOptionsSchema = z
  .object({
    client: z.enum(['codex', 'claude']),
    event: z.enum(['SessionStart', 'SubagentStart']),
    project: z.array(z.string().min(1).max(4096)).min(1).max(32).optional(),
    'project-set': z
      .string()
      .min(1)
      .max(4096)
      .refine(isAbsolute, 'Project set must be an absolute definition path')
      .optional(),
  })
  .superRefine((value, context) => {
    if (value['project-set']) {
      if (value.project?.some((label) => label.length > 128)) {
        context.addIssue({ code: 'custom', message: 'Project selection labels must fit 128 characters' });
      }
      return;
    }
    if (!value.project) return;
    if (value.project.length !== 1) {
      context.addIssue({ code: 'custom', message: 'Without project-set, assign exactly one checkout' });
      return;
    }
    if (!isAbsolute(value.project[0])) {
      context.addIssue({ code: 'custom', message: 'Worker checkout assignment must be an absolute path' });
    }
  });

export interface BootstrapCommandOptions extends GlobalOptions {
  client: 'codex' | 'claude';
  event: 'SessionStart' | 'SubagentStart';
  project?: string[];
  'project-set'?: string;
  url?: string;
  context?: string;
  preset?: string;
  tags?: string[];
  'tag-filter'?: string;
}

// Both clients document these fields. Agent identity and cwd are deliberately not assignment channels.
const hookInputSchema = z
  .object({
    hook_event_name: z.enum(['SessionStart', 'SubagentStart']),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    agent_id: z.string().optional(),
    agent_type: z.string().optional(),
  })
  .passthrough();

export async function readBootstrapInput(input: Readable, deadlineMs = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: Error) => {
      clearTimeout(timer);
      input.off('data', onData);
      input.off('end', onEnd);
      input.off('error', onError);
      input.pause();
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > BOOTSTRAP_INPUT_LIMIT) {
        finish(new Error('Hook input exceeds 64 KiB'));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => finish();
    const onError = (error: Error) => finish(error);
    const timer = setTimeout(() => finish(new Error('Hook stdin deadline exceeded')), deadlineMs);
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onError);
    input.resume();
  });
}

export function buildInstructionsArguments(options: BootstrapCommandOptions): string[] {
  const args = ['instructions'];
  for (const project of options.project ?? []) args.push(`--project=${project}`);
  for (const key of ['project-set', 'url', 'context', 'preset', 'tag-filter', 'config', 'config-dir'] as const) {
    const value = options[key];
    if (typeof value === 'string') args.push(`--${key}=${value}`);
  }
  for (const tag of options.tags ?? []) args.push(`--tags=${tag}`);
  return args;
}

/** No shell, no stdin forwarding, and only the owned child is terminated on a deadline. */
export async function runInstructionsProcess(
  executable: string,
  args: string[],
  deadlineMs = BOOTSTRAP_DEADLINE_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const environment = { ...getRuntimeParentEnvironment() };
    for (const key of Object.keys(environment)) {
      if (['ONE_MCP_PROJECT', 'ONE_MCP_PROJECT_SET'].includes(key.toUpperCase())) delete environment[key];
    }
    const child = spawn(executable, args, { shell: false, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill('SIGKILL');
        reject(error);
        return;
      }
      const output = Buffer.concat(chunks).toString('utf8').trim();
      if (!output) reject(new Error('Runtime returned no instructions'));
      else resolve(output);
    };
    const timer = setTimeout(() => finish(new Error('Runtime instructions deadline exceeded')), deadlineMs);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > RUNTIME_OUTPUT_LIMIT) {
        finish(new Error('Runtime instructions exceeded output limit'));
        return;
      }
      chunks.push(chunk);
    });
    // Drain stderr without retaining potentially sensitive runtime diagnostics.
    child.stderr.resume();
    child.once('error', () => finish(new Error('Runtime instructions process unavailable')));
    child.once('close', (code) => {
      if (code !== 0) finish(new Error('Runtime instructions failed'));
      else finish();
    });
  });
}

export async function renderBootstrapContext(
  options: BootstrapCommandOptions,
  input: string,
  renderInstructions: (options: BootstrapCommandOptions) => Promise<string>,
): Promise<string> {
  const playbook = renderManagedDocContent();
  try {
    bootstrapOptionsSchema.parse(options);
    if (input.trim()) {
      const parsed = hookInputSchema.parse(JSON.parse(input));
      if (parsed.hook_event_name !== options.event) throw new Error('Hook event does not match --event');
    }
    const assignment = options['project-set']
      ? { projectSet: options['project-set'], selection: options.project }
      : options.project;
    if (options.event === 'SubagentStart' && !assignment) {
      return `${playbook}\nWorker Project Assignment unresolved. Parent session identity and hook cwd are not targets. Before project-specific instructions or tools, obtain the dispatch assignment and run bootstrap with an explicit absolute --project path or --project-set definition path. Select an explicit target for each checkout-specific call in a multi-project set.\nBootstrap coverage gap: project-specific instructions have not been fetched.\n`;
    }
    const selection = assignment ? `Explicit Worker Project Assignment: ${JSON.stringify(assignment)}\n` : '';
    const prefix = `${playbook}\n${selection}`;
    const budgetGap =
      'Bootstrap coverage gap: runtime instructions exceed the client context budget. Fetch scoped instructions explicitly before using a server.\n';
    if (prefix.length + budgetGap.length > BOOTSTRAP_CONTEXT_LIMIT) {
      return `${playbook}\nBootstrap coverage gap: the escaped assignment exceeds the client context budget and was omitted. Worker Project Assignment unresolved in delivered context. Obtain the original assignment from dispatch instructions and use its explicit --project or --project-set selector to fetch scoped instructions before project-specific tool use.\n`;
    }
    const rendered = await renderInstructions(options);
    const remaining = BOOTSTRAP_CONTEXT_LIMIT - prefix.length;
    if (rendered.length > remaining) {
      return `${prefix}${budgetGap}`;
    }
    return `${prefix}${rendered}`;
  } catch {
    return `${playbook}\nBootstrap coverage gap: input, assignment, or runtime instructions could not be verified. Project-specific instructions were not delivered. Resolve an explicit assignment and rerun scoped instructions before project-specific tool use.\n`;
  }
}

export async function bootstrapCommand(options: BootstrapCommandOptions): Promise<void> {
  let input: string;
  try {
    input = await readBootstrapInput(process.stdin);
  } catch {
    input = '!invalid-hook-input';
  }
  const context = await renderBootstrapContext(options, input, async (selected) => {
    const args = buildInstructionsArguments(selected);
    const cliArgs = isSea() ? args : [process.argv[1], ...args];
    return runInstructionsProcess(process.execPath, cliArgs);
  });
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: options.event, additionalContext: context } })}\n`,
  );
}
