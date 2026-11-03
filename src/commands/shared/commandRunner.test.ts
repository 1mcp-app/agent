import * as loggerConfiguration from '@src/logger/configureGlobalLogger.js';
import { RuntimeProbeError } from '@src/domains/runtime-targets/runtimeProbe.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCliCommand } from './commandRunner.js';

const usage = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock('@src/productTelemetry/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/productTelemetry/index.js')>()),
  beginProductCommand: vi.fn(() => usage),
}));

describe('runCliCommand', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    usage.finish.mockClear();
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    process.exitCode = undefined;
    stdout.mockRestore();
    stderr.mockRestore();
    exit.mockRestore();
  });

  it('writes structured JSON failure envelopes when json mode is requested', async () => {
    await runCliCommand({ json: true }, async () => {
      throw Object.assign(new Error('Runtime target import bundle failed validation'), {
        code: 'target_import_validation_failed',
        details: {
          validationFacts: [{ code: 'target_name_conflict', targetName: 'prod' }],
        },
        recoveryCommand: '1mcp target import targets.json --dry-run',
      });
    });

    expect(stderr).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: false;
      cliProtocolVersion: string;
      requestId: string;
      error: {
        code: string;
        message: string;
        recoveryCommand?: string;
        details?: unknown;
      };
    };
    expect(envelope).toMatchObject({
      ok: false,
      cliProtocolVersion: '1',
      error: {
        code: 'target_import_validation_failed',
        message: 'Runtime target import bundle failed validation',
        recoveryCommand: '1mcp target import targets.json --dry-run',
        details: {
          validationFacts: [{ code: 'target_name_conflict', targetName: 'prod' }],
        },
      },
    });
    expect(envelope.requestId).toEqual(expect.any(String));
  });

  it('writes structured JSON failure envelopes when format json is requested', async () => {
    await runCliCommand({ format: 'json' }, async () => {
      throw Object.assign(new Error('Timed out waiting for filesystem'), {
        code: 'server_wait_timeout',
        details: { status: 'timeout', servers: [] },
        recoveryCommand: '1mcp wait filesystem',
      });
    });

    expect(stderr).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string; details: { status: string } };
    };
    expect(envelope.error).toMatchObject({
      code: 'server_wait_timeout',
      details: { status: 'timeout' },
    });
  });

  it('preserves retryability and structured probe details for agents', async () => {
    await runCliCommand({ format: 'json' }, async () => {
      throw new RuntimeProbeError(
        {
          failureKind: 'http_rejection',
          endpoint: '/oauth/',
          reason: 'Too many requests, please try again later.',
          retryable: true,
          httpStatus: 429,
          retryAfterSeconds: 60,
        },
        {
          targetKind: 'local',
          configDir: '/tmp/runtime-scope',
          pid: 4242,
          recoveryCommand: '1mcp serve --status --config-dir /tmp/runtime-scope',
        },
      );
    });

    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string; retryable?: boolean; details?: unknown };
    };
    expect(envelope.error).toMatchObject({
      code: 'runtime_probe_failed',
      retryable: true,
      details: {
        httpStatus: 429,
        retryAfterSeconds: 60,
        nextAction: 'retry_original_command',
      },
    });
  });

  it('renders bounded probe guidance instead of raw JSON details for humans', async () => {
    await runCliCommand({}, async () => {
      throw new RuntimeProbeError(
        {
          failureKind: 'connection_refused',
          endpoint: '/.well-known/1mcp/runtime-identity',
          reason: 'Connection refused (ECONNREFUSED)',
          retryable: true,
        },
        {
          targetKind: 'local',
          configDir: '/tmp/runtime-scope',
          pid: 4242,
          recoveryCommand: '1mcp serve --status --config-dir /tmp/runtime-scope',
        },
      );
    });

    const output = stderr.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(output).toContain('runtime_probe_failed: Runtime process 4242 is alive');
    expect(output).toContain('Reason: Connection refused (ECONNREFUSED)');
    expect(output).toContain('Next action: Run the recovery command');
    expect(output).toContain('Recovery: 1mcp serve --status --config-dir /tmp/runtime-scope');
    expect(output).not.toContain('Details:');
  });

  it('uses target safety exit code for JSON recovery failures', async () => {
    await runCliCommand({ json: true }, async () => {
      throw Object.assign(new Error('Runtime target uses imported insecure TLS metadata and requires confirmation'), {
        code: 'target_insecure_tls_confirmation_required',
        recoveryCommand: '1mcp target verify lab --accept-insecure-tls',
      });
    });

    expect(process.exitCode).toBe(4);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string; recoveryCommand?: string };
    };
    expect(envelope.error).toMatchObject({
      code: 'target_insecure_tls_confirmation_required',
      recoveryCommand: '1mcp target verify lab --accept-insecure-tls',
    });
  });

  it('uses local usage exit code for credential context errors', async () => {
    await runCliCommand({ json: true }, async () => {
      throw Object.assign(new Error('Admin credential commands require --context <name>'), {
        code: 'credential_context_required',
        recoveryCommand: '1mcp admin status --context prod',
      });
    });

    expect(process.exitCode).toBe(2);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string; recoveryCommand?: string };
    };
    expect(envelope.error).toMatchObject({
      code: 'credential_context_required',
      recoveryCommand: '1mcp admin status --context prod',
    });
  });
});

describe('closed inspect attribution inside error presentation', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    usage.finish.mockClear();
  });
  it.each(['text', 'json'])('marks synchronous and asynchronous failures before %s presentation', async (format) => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    for (const fail of [
      () => {
        throw new Error('private failure');
      },
      async () => {
        throw new Error('private failure');
      },
    ]) {
      usage.finish.mockClear();
      await runCliCommand({ format }, fail, 'inspect');
      expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failure');
      if (format === 'json') expect(process.exitCode).toBe(1);
      else expect(exit).toHaveBeenCalledWith(1);
    }
  });
  it('counts logger setup failure without changing its rejection or invoking the command', async () => {
    const failure = new Error('controlled logger setup failure');
    vi.spyOn(loggerConfiguration, 'configureGlobalLogger').mockImplementationOnce(() => {
      throw failure;
    });
    const handler = vi.fn(async () => {});
    await expect(runCliCommand({}, handler, 'inspect')).rejects.toBe(failure);
    expect(handler).not.toHaveBeenCalled();
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failure');
  });
  it('marks success once without changing result output', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    usage.finish.mockClear();
    await runCliCommand(
      {},
      async () => {
        process.stdout.write('original result');
      },
      'inspect',
    );
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('success');
    expect(stdout).toHaveBeenCalledExactlyOnceWith('original result');
  });
});
