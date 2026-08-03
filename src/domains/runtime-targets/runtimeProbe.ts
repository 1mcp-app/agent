import http from 'node:http';

export type RuntimeProbeFailureKind =
  'http_rejection' | 'connection_refused' | 'timeout' | 'tls_failure' | 'invalid_response' | 'network_failure';

export interface RuntimeProbeFailure {
  failureKind: RuntimeProbeFailureKind;
  endpoint: string;
  reason: string;
  retryable: boolean;
  httpStatus?: number;
  retryAfterSeconds?: number;
}

export interface RuntimeProbeContext {
  targetKind: 'local' | 'remote' | 'ephemeral';
  targetName?: string;
  configDir?: string;
  pid?: number;
  recoveryCommand?: string;
}

export interface RuntimeProbeErrorDetails extends RuntimeProbeFailure {
  targetKind: RuntimeProbeContext['targetKind'];
  targetName?: string;
  configDir?: string;
  pid?: number;
  nextAction: 'retry_original_command' | 'inspect_runtime_status' | 'verify_target';
}

export class RuntimeProbeError extends Error {
  readonly code = 'runtime_probe_failed';
  readonly retryable: boolean;
  readonly details: RuntimeProbeErrorDetails;
  readonly humanDetails: string[];
  readonly recoveryCommand?: string;

  constructor(failure: RuntimeProbeFailure, context: RuntimeProbeContext) {
    const nextAction = resolveNextAction(failure, context);
    super(formatRuntimeProbeMessage(failure, context));
    this.name = 'RuntimeProbeError';
    this.retryable = failure.retryable;
    this.recoveryCommand = failure.httpStatus === 429 ? undefined : context.recoveryCommand;
    this.details = {
      ...failure,
      targetKind: context.targetKind,
      ...(context.targetName ? { targetName: context.targetName } : {}),
      ...(context.configDir ? { configDir: context.configDir } : {}),
      ...(context.pid !== undefined ? { pid: context.pid } : {}),
      nextAction,
    };
    this.humanDetails = formatHumanDetails(failure, nextAction, this.recoveryCommand);
  }
}

export function localRuntimeStatusCommand(configDir?: string): string {
  return configDir ? `1mcp serve --status --config-dir ${quoteCommandArgument(configDir)}` : '1mcp serve --status';
}

export function runtimeTargetVerifyCommand(targetName: string): string {
  return `1mcp target verify ${quoteCommandArgument(targetName)}`;
}

function resolveNextAction(
  failure: RuntimeProbeFailure,
  context: RuntimeProbeContext,
): RuntimeProbeErrorDetails['nextAction'] {
  if (failure.httpStatus === 429) {
    return 'retry_original_command';
  }
  return context.targetKind === 'local' ? 'inspect_runtime_status' : 'verify_target';
}

function formatRuntimeProbeMessage(failure: RuntimeProbeFailure, context: RuntimeProbeContext): string {
  if (failure.httpStatus !== undefined) {
    const statusText = http.STATUS_CODES[failure.httpStatus];
    return `Runtime probe was rejected: HTTP ${failure.httpStatus}${statusText ? ` ${statusText}` : ''}`;
  }
  if (context.targetKind === 'local' && context.pid !== undefined) {
    return `Runtime process ${context.pid} is alive, but its endpoint did not respond`;
  }
  return 'Runtime probe failed before receiving a usable response';
}

function formatHumanDetails(
  failure: RuntimeProbeFailure,
  nextAction: RuntimeProbeErrorDetails['nextAction'],
  recoveryCommand?: string,
): string[] {
  const lines = [`Endpoint: ${failure.endpoint}`, `Reason: ${failure.reason}`];
  if (failure.httpStatus === 429 && failure.retryAfterSeconds !== undefined) {
    lines.push(`Retry-After: ${failure.retryAfterSeconds} seconds`);
  }
  if (nextAction === 'retry_original_command') {
    lines.push(
      failure.retryAfterSeconds !== undefined
        ? `Next action: Wait ${failure.retryAfterSeconds} seconds, then retry the original command.`
        : 'Next action: Retry the original command after the rate limit resets.',
    );
  } else if (recoveryCommand) {
    lines.push('Next action: Run the recovery command to inspect the target, then retry the original command.');
  } else {
    lines.push('Next action: Verify target reachability and configuration, then retry the original command.');
  }
  return lines;
}

function quoteCommandArgument(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
