import type { GlobalOptions } from '@src/globalOptions.js';

import { type CliSetupTarget, formatCliSetupOutput, resolveCliSetupScope, writeCliSetupFiles } from './setupFiles.js';

export interface CliSetupCommandOptions extends GlobalOptions {
  scope?: string;
  claude?: boolean;
  codex?: boolean;
  'repo-root'?: string;
}

export async function cliSetupCommand(options: CliSetupCommandOptions): Promise<void> {
  const results = await writeCliSetupFiles({
    repoRoot: options['repo-root'] ?? process.cwd(),
    scope: resolveCliSetupScope(options.scope),
    targets: resolveCliSetupTargetsFromFlags(options),
  });

  process.stdout.write(`${formatCliSetupOutput(results)}\n`);
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
