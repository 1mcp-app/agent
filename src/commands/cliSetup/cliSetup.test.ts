import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cliSetupCommand, resolveCliSetupTargetsFromFlags } from './cliSetup.js';

const mockedStdoutWrite = vi.hoisted(() => vi.fn());

describe('cliSetup command', () => {
  beforeEach(() => {
    mockedStdoutWrite.mockReset();

    vi.stubGlobal('process', {
      ...process,
      stdout: {
        ...process.stdout,
        write: mockedStdoutWrite,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes a summary for the default global setup flow', async () => {
    await cliSetupCommand({
      'config-dir': '.tmp-test/cli-setup-command',
      scope: 'repo',
      codex: true,
      'repo-root': '.tmp-test/cli-setup-command/repo',
    } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Updated 1MCP CLI setup files:'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('1MCP.md'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('AGENTS.md'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('hooks.json'));
    expect(mockedStdoutWrite).not.toHaveBeenCalledWith(expect.stringContaining('settings.json'));
  });

  it('requires exactly one client flag', () => {
    expect(() => resolveCliSetupTargetsFromFlags({})).toThrow('Specify exactly one client');
    expect(() => resolveCliSetupTargetsFromFlags({ codex: true, claude: true })).toThrow(
      'Specify only one client at a time',
    );
    expect(resolveCliSetupTargetsFromFlags({ codex: true })).toEqual(['codex']);
    expect(resolveCliSetupTargetsFromFlags({ claude: true })).toEqual(['claude']);
  });
});
