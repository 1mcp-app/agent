import type { GlobalOptions } from '@src/globalOptions.js';

import { type CliSetupTarget, formatCliSetupOutput, resolveCliSetupScope, writeCliSetupFiles } from './setupFiles.js';

export interface CliSetupCommandOptions extends GlobalOptions {
  scope?: string;
  claude?: boolean;
  codex?: boolean;
  'repo-root'?: string;
}

export async function cliSetupCommand(options: CliSetupCommandOptions): Promise<void> {
  const targets = resolveCliSetupTargetsFromFlags(options);
  const results = await writeCliSetupFiles({
    repoRoot: options['repo-root'] ?? process.cwd(),
    scope: resolveCliSetupScope(options.scope),
    targets,
  });

  process.stdout.write(`${formatCliSetupOutput(results)}\n`);

  if (targets.includes('codex')) {
    process.stdout.write(`\n${formatCodexConfigNotice()}\n`);
  }
}

export function formatCodexConfigNotice(): string {
  const configContent = [
    'approval_policy = "on-request"',
    'sandbox_mode    = "workspace-write"',
    '',
    '[sandbox_workspace_write]',
    'network_access = true',
    '',
    '[features]',
    'codex_hooks = true',
  ].join('\n');

  return [
    'Action required: update your Codex config.toml (~/.codex/config.toml) to include:',
    '',
    configContent,
    '',
    'This enables hooks support and allows 1MCP to run within the Codex sandbox.',
  ].join('\n');
}

export function resolveCliSetupTargetsFromFlags(
  options: Pick<CliSetupCommandOptions, 'claude' | 'codex'>,
): CliSetupTarget[] {
  const targets: CliSetupTarget[] = [];

  if (options.codex) {
    targets.push('codex');
  }
  if (options.claude) {
    targets.push('claude');
  }

  if (targets.length === 0) {
    throw new Error('Specify exactly one client: use `--codex` or `--claude`.');
  }

  if (targets.length > 1) {
    throw new Error('Specify only one client at a time: use either `--codex` or `--claude`.');
  }

  return targets;
}
