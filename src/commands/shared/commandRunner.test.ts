import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCliCommand } from './commandRunner.js';

describe('runCliCommand', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
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
});
