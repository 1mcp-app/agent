import type { GlobalOptions } from '@src/globalOptions.js';

export async function runCliCommand<T extends GlobalOptions & { json?: boolean }>(
  argv: T,
  fn: (argv: T) => Promise<void>,
): Promise<void> {
  const { configureGlobalLogger } = await import('@src/logger/configureGlobalLogger.js');
  configureGlobalLogger(argv, 'stdio');
  try {
    await fn(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = exitCodeForError(error);
    if (hasJsonOutput(argv)) {
      process.stdout.write(`${JSON.stringify(jsonFailureEnvelope(error, message))}\n`);
      process.exitCode = exitCode;
      return;
    }
    process.stderr.write(`${formatErrorForHuman(error, message)}\n`);
    process.exit(exitCode);
  }
}

function hasJsonOutput(argv: GlobalOptions & { json?: boolean }): boolean {
  return argv.json === true;
}

function jsonFailureEnvelope(error: unknown, message: string) {
  const coded = isCodedError(error) ? error : undefined;
  return {
    ok: false,
    cliProtocolVersion: '1',
    requestId: createCliRequestId(),
    error: {
      code: coded?.code ?? 'command_failed',
      message,
      ...(coded?.recoveryCommand ? { recoveryCommand: coded.recoveryCommand } : {}),
      ...(coded && 'details' in coded && coded.details !== undefined ? { details: coded.details } : {}),
    },
  };
}

function isCodedError(
  error: unknown,
): error is { code: string; message: string; recoveryCommand?: string; details?: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string';
}

function formatErrorForHuman(error: unknown, message: string): string {
  if (!isCodedError(error)) {
    return message;
  }
  const detailsMessage =
    'details' in error && error.details !== undefined ? `\nDetails: ${JSON.stringify(error.details)}` : '';
  return `${error.code}: ${message}${detailsMessage}${error.recoveryCommand ? `\nRecovery: ${error.recoveryCommand}` : ''}`;
}

function exitCodeForError(error: unknown): number {
  if (!isCodedError(error)) {
    return 1;
  }
  if (error.code === 'target_argument_missing' || error.code.endsWith('_validation_failed')) {
    return 2;
  }
  if (error.code.startsWith('auth_') || error.code.includes('session')) {
    return 3;
  }
  if (
    error.code.startsWith('target_') ||
    error.code.startsWith('identity_') ||
    error.code.includes('protocol') ||
    error.code.includes('capability')
  ) {
    return 4;
  }
  return 1;
}

function createCliRequestId(): string {
  return `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
