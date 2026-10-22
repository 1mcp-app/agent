import type { GlobalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export interface ProjectSelectionOptions {
  project?: string[];
  'project-set'?: string;
}

export const projectSelectionOptions = {
  project: {
    describe:
      'Per-call checkout override, or selected labels from --project-set; defaults to the assigned session project or cwd',
    type: 'array' as const,
    string: true,
    nargs: 1,
    requiresArg: true,
    global: false,
  },
  'project-set': {
    describe: 'Path to a saved JSON project-set definition (no global project switch)',
    type: 'string' as const,
    requiresArg: true,
    global: false,
  },
} as const;

export function withProjectSelectionOptions(yargs: Argv): Argv<GlobalOptions & ProjectSelectionOptions> {
  return yargs.options(projectSelectionOptions).group(Object.keys(projectSelectionOptions), 'Project selection:');
}
