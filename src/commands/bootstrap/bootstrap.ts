import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Readable } from 'node:stream';

import { resolveAgentSessionOptions } from '@src/commands/shared/agentSession.js';
import { reconcileProjectOwnerCalls, withProjectOwnerLock } from '@src/commands/shared/projectOwnerStore.js';
import { type ProjectOwnerTarget, readProjectOwnerAssignment } from '@src/commands/shared/projectOwnerStore.js';
import type { ProjectSelectionOptions } from '@src/commands/shared/projectSelectionOptions.js';
import { getRuntimeParentEnvironment } from '@src/config/runtimeBootstrap.js';
import { renderManagedDocContent } from '@src/core/instructions/instructionsDistribution.js';
import { readProcessIdentity } from '@src/core/server/processIdentity.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { isSea } from 'node:sea';
import { z } from 'zod';

import { bootstrapOwner, releaseSessionOwner } from './bootstrapOwnership.js';

export const BOOTSTRAP_INPUT_LIMIT = 64 * 1024;
export const BOOTSTRAP_INSTRUCTIONS_ADVISORY_THRESHOLD = 9000;
export const BOOTSTRAP_DEADLINE_MS = 5000;

const instructionsFailures = {
  instructions_timeout: 'Runtime instructions deadline exceeded',
  instructions_unavailable: 'Runtime instructions process unavailable',
  instructions_failed: 'Runtime instructions failed',
  instructions_empty: 'Runtime returned no instructions',
} as const;

class InstructionsProcessError extends Error {
  constructor(readonly code: keyof typeof instructionsFailures) {
    super(instructionsFailures[code]);
  }
}

function bootstrapGap(playbook: string, reason: string, recovery: string): string {
  return `${playbook}\nBootstrap coverage gap [${reason}]: project-specific instructions were not delivered. ${recovery}\n`;
}
export const bootstrapOptionsSchema = z
  .object({
    client: z.enum(['codex', 'claude']),
    event: z.enum(['SessionStart', 'SubagentStart', 'SessionEnd']),
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

export interface BootstrapCommandOptions extends GlobalOptions, ProjectSelectionOptions {
  client: 'codex' | 'claude';
  event: 'SessionStart' | 'SubagentStart' | 'SessionEnd';
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
    const timer = setTimeout(
      () => finish(bytes === 0 ? undefined : new Error('Hook stdin deadline exceeded')),
      deadlineMs,
    );
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onError);
    input.resume();
  });
}

export function buildInstructionsArguments(options: BootstrapCommandOptions): string[] {
  const args = ['instructions'];
  for (const project of options.project ?? []) args.push(`--project=${project}`);
  for (const key of [
    'project-set',
    'project-owner',
    'url',
    'context',
    'preset',
    'tag-filter',
    'config',
    'config-dir',
  ] as const) {
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
  ownerFile?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const environment = { ...getRuntimeParentEnvironment() };
    for (const key of Object.keys(environment)) {
      if (['ONE_MCP_PROJECT', 'ONE_MCP_PROJECT_SET'].includes(key.toUpperCase())) delete environment[key];
    }
    // This implementation child belongs to the outer invocation, not a second command adoption.
    environment.ONE_MCP_PRODUCT_TELEMETRY = 'false';
    const child = spawn(executable, args, { shell: false, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const childIdentity = child.pid ? readProcessIdentity(child.pid) : undefined;
    const chunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, deadlineMs);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.resume();
    child.once('error', () => {
      clearTimeout(timer);
      reject(new InstructionsProcessError('instructions_unavailable'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      const finish = async () => {
        if (ownerFile && child.pid) {
          try {
            await withProjectOwnerLock(
              ownerFile,
              () => reconcileProjectOwnerCalls(ownerFile, { pid: child.pid!, identity: childIdentity }),
              { waitMs: 0 },
            );
          } catch {
            // Optional cleanup must not replace the child's result. Retain uncertain leases for recovery.
          }
        }
        if (timedOut) throw new InstructionsProcessError('instructions_timeout');
        if (code !== 0) throw new InstructionsProcessError('instructions_failed');
        const output = Buffer.concat(chunks).toString('utf8').trim();
        if (!output) throw new InstructionsProcessError('instructions_empty');
        return output;
      };
      void finish().then(resolve, reject);
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
  } catch {
    return bootstrapGap(
      playbook,
      'invalid_assignment',
      'Validate the client/event and use one absolute checkout or an absolute project-set definition with valid member labels before rerunning bootstrap.',
    );
  }
  try {
    if (input.trim()) {
      const parsed = hookInputSchema.parse(JSON.parse(input));
      if (parsed.hook_event_name !== options.event) throw new Error('Hook event does not match --event');
    }
  } catch {
    return bootstrapGap(
      playbook,
      'invalid_hook_input',
      'Check that the hook delivers complete JSON with a matching hook_event_name, then rerun bootstrap with the assigned target.',
    );
  }
  const assignment = options['project-set']
    ? { projectSet: options['project-set'], selection: options.project }
    : options.project;
  if (options.event === 'SubagentStart' && !assignment) {
    return bootstrapGap(
      playbook,
      'assignment_unresolved',
      'Worker Project Assignment unresolved. Parent session identity and hook cwd are not targets. Before project-specific instructions or tools, obtain the dispatch assignment and run bootstrap with an explicit absolute --project path or --project-set definition path. Select an explicit target for each checkout-specific call in a multi-project set.',
    );
  }
  const selection = assignment ? `Explicit Worker Project Assignment: ${JSON.stringify(assignment)}\n` : '';
  const prefix = `${playbook}\n${selection}`;
  try {
    const rendered = await renderInstructions(options);
    if (rendered.length > BOOTSTRAP_INSTRUCTIONS_ADVISORY_THRESHOLD) {
      return `${prefix}${rendered}\n\n=== PRESET ADVISORY FOR THE AGENT ===\nInform the user briefly that the 1MCP instructions are large. Recommend using a 1MCP preset to select fewer relevant MCP servers in future sessions, for example \`1mcp instructions --preset <name>\`. All instructions have been delivered; continue the current task. Do not change the user's configuration automatically.\n`;
    }
    return `${prefix}${rendered}`;
  } catch (error) {
    const reason = error instanceof InstructionsProcessError ? error.code : 'instructions_failed';
    return bootstrapGap(
      prefix,
      reason,
      `${instructionsFailures[reason]}. Check runtime availability and rerun 1mcp instructions with the same assignment, runtime and filters before project-specific tool use. Do not change targets or permissions to bypass the failure.`,
    );
  }
}

export async function bootstrapCommand(options: BootstrapCommandOptions): Promise<void> {
  let input: string;
  try {
    input = process.stdin.isTTY ? '' : await readBootstrapInput(process.stdin);
  } catch {
    input = '!invalid-hook-input';
  }
  if (options.event === 'SessionEnd') {
    try {
      await releaseSessionOwner(options, input, releaseRecordedOwnerTarget);
      process.stdout.write(`${JSON.stringify({ suppressOutput: true })}\n`);
    } catch (error) {
      const detail = cleanupFailureDetail(error);
      process.exitCode = 1;
      process.stderr.write(`Ownership cleanup coverage gap: ${detail}. Inspect project status before removal.\n`);
      process.stdout.write(
        `${JSON.stringify({ systemMessage: `Ownership cleanup coverage gap: ${detail}. Retry recorded terminal cleanup with project recover --project-owner <own-file>; inspect project status before removal.` })}\n`,
      );
    }
    return;
  }
  let ownerMessage = '';
  let ownedOptions = options;
  try {
    const manualOptions = input.trim() ? options : await resolveAgentSessionOptions(options);
    if (input.trim() || manualOptions['project-owner']) {
      bootstrapOptionsSchema.parse(options);
      const ownerFile = await bootstrapOwner(manualOptions, input);
      ownedOptions = { ...options, 'project-owner': ownerFile };
      if (options.event === 'SubagentStart' && !options.project && !options['project-set']) {
        const assignment = await readProjectOwnerAssignment(ownerFile);
        if (assignment?.project || assignment?.['project-set']) {
          ownedOptions = { ...ownedOptions, project: assignment.project, 'project-set': assignment['project-set'] };
        }
      }
      ownerMessage = `\nCaller ownership: your private fallback is --project-owner ${JSON.stringify(ownerFile)}. Codex CODEX_THREAD_ID resolves this credential through its private hook-written thread locator; CODEX_SESSION_ID, when present, must agree. Both IDs also support legacy direct resolution; normal calls omit --project-owner. Hosts without a trustworthy locator or both-ID integration and Claude require this explicit reference. Use the verified startup project by default; an assigned worker retains its dispatch default after per-call overrides. Do not pass this credential reference to parent, sibling, or child workers; each worker receives its own at bootstrap. Turn completion does not end ownership. Remote runtimes do not support this local ownership credential; remote instruction and tool calls remain available without local release coverage.\n`;
    }
  } catch {
    ownerMessage =
      '\nOwnership coverage gap: a verified session/worker identity, assigned default, or private owner storage was unavailable. No caller credential was fabricated; retain your own hook reference and resolve the reported sandbox or assignment gap. Do not release another caller.\n';
  }
  const context = await renderBootstrapContext(ownedOptions, input, async (selected) => {
    const args = buildInstructionsArguments(selected);
    const cliArgs = isSea() ? args : [process.argv[1], ...args];
    return runInstructionsProcess(process.execPath, cliArgs, BOOTSTRAP_DEADLINE_MS, selected['project-owner']);
  });
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: options.event, additionalContext: context + ownerMessage } })}\n`,
  );
}

export async function releaseRecordedOwnerTarget(ownerFile: string, target: ProjectOwnerTarget): Promise<void> {
  const args = ['project', 'release', '--terminal-cleanup', '--format=json', `--project-owner=${ownerFile}`];
  if (target['project-set']) args.push(`--project-set=${target['project-set']}`);
  else for (const project of target.project) args.push(`--project=${project}`);
  for (const key of ['config-dir', 'config', 'context', 'url'] as const) {
    if (target[key]) args.push(`--${key}=${target[key]}`);
  }
  args.push(`--expected-runtime-scope=${target.runtimeScopeId}`);
  await runInstructionsProcess(process.execPath, isSea() ? args : [process.argv[1], ...args], 2000);
}

/** Only fixed local lifecycle diagnostics are safe to expose through hook output. */
function cleanupFailureDetail(error: unknown): string {
  const messages = [
    'Session cleanup has pending or uncertain caller leases; retry after calls finish or inspect abandoned state',
    'Session ownership cleanup is incomplete',
    'Owner state is busy or has an abandoned lock; inspect before recovery',
    'Owner credential is missing but recovery records remain; inspect uncertain cleanup',
    'Terminal cleanup requires persisted release proof',
    'Session owner changed during terminal selection; no cleanup performed',
  ];
  if (error instanceof Error && messages.includes(error.message)) return error.message;
  return 'session identity, recorded target, or runtime release could not be verified';
}
