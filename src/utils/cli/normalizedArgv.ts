import { hideBin } from 'yargs/helpers';

export function normalizeCliArgv(argv: string[]): string[] {
  if (argv[0] === '--') {
    return argv.slice(1);
  }

  return argv;
}

export const normalizedArgv = normalizeCliArgv(hideBin(process.argv));
