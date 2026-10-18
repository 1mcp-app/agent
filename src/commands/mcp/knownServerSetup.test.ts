import { createKnownServerSetupWorkflow } from '@src/domains/installation/knownServerSetup.js';
import { createRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import printer from '@src/utils/ui/printer.js';

import prompts from 'prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectSetupExample, setupKnownServer } from './knownServerSetup.js';
import { setupCommand, type SetupCommandArgs } from './setup.js';

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@src/domains/installation/knownServerSetup.js', () => ({
  createKnownServerSetupWorkflow: vi.fn(() => ({ run })),
}));
vi.mock('@src/domains/registry/mcpRegistryClient.js', () => ({ createRegistryClient: vi.fn() }));
vi.mock('./utils/mcpServerConfig.js', () => ({ initializeConfigContext: vi.fn() }));
vi.mock('prompts', () => ({ default: vi.fn() }));
vi.mock('@src/utils/ui/printer.js', () => ({
  default: { keyValue: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

function args(options: Partial<SetupCommandArgs> = {}): SetupCommandArgs {
  return { known: 'codegraph', ...options } as SetupCommandArgs;
}

describe('maintained example setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    run.mockImplementation(async ({ mode }) => ({
      status: mode === 'preview' ? 'preview' : 'applied',
      targetName: 'codegraph',
      setupFingerprint: 'preview-fingerprint',
      config: { type: 'stdio', command: '/opt/bin/codegraph' },
      warnings: ['Native initialization remains a separate step.'],
      configChange: { changed: false, reload: { status: 'skipped' }, backup: {} },
    }));
  });

  it('offers exactly three examples', async () => {
    vi.mocked(prompts).mockResolvedValue({ example: 'serena' });
    expect(await selectSetupExample()).toBe('serena');
    expect(prompts).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          expect.objectContaining({ value: 'codegraph' }),
          expect.objectContaining({ value: 'code-review-graph' }),
          expect.objectContaining({ value: 'serena' }),
        ],
      }),
    );
  });

  it('routes an explicit example without creating a registry client or prompting', async () => {
    await setupCommand(args());
    expect(createKnownServerSetupWorkflow).toHaveBeenCalledOnce();
    expect(createRegistryClient).not.toHaveBeenCalled();
    expect(prompts).not.toHaveBeenCalled();
    expect(run).toHaveBeenLastCalledWith({
      mode: 'apply',
      force: undefined,
      expectedSetupFingerprint: 'preview-fingerprint',
      source: {
        type: 'known',
        exampleId: 'codegraph',
        localName: undefined,
        executable: undefined,
        checkout: undefined,
      },
    });
    expect(printer.keyValue).toHaveBeenCalledWith({ Configuration: 'Unchanged', Reload: 'skipped' });
  });

  it('passes explicit static binding and reconfiguration options', async () => {
    await setupKnownServer(args({ checkout: '/project', executable: '/tools/codegraph', name: 'source', force: true }));
    expect(run).toHaveBeenLastCalledWith({
      mode: 'apply',
      force: true,
      expectedSetupFingerprint: 'preview-fingerprint',
      source: {
        type: 'known',
        exampleId: 'codegraph',
        localName: 'source',
        executable: '/tools/codegraph',
        checkout: '/project',
      },
    });
  });

  it('previews without mutation or prompting even with interactive requested', async () => {
    await setupKnownServer(args({ dryRun: true, interactive: true }));
    expect(run).toHaveBeenCalledOnce();
    expect(prompts).not.toHaveBeenCalled();
    expect(printer.warn).toHaveBeenCalledWith('Native initialization remains a separate step.');
  });

  it('cancellation at confirmation never applies configuration', async () => {
    vi.mocked(prompts).mockResolvedValue({});
    await setupKnownServer(args({ interactive: true }));
    expect(run).toHaveBeenCalledOnce();
    expect(printer.success).not.toHaveBeenCalled();
  });

  it('selects and confirms an example through interactive setup', async () => {
    vi.mocked(prompts).mockResolvedValueOnce({ example: 'serena' }).mockResolvedValueOnce({ confirmed: true });
    await setupCommand(args({ known: undefined }));
    expect(run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'apply',
        source: expect.objectContaining({ exampleId: 'serena' }),
      }),
    );
    expect(createRegistryClient).not.toHaveBeenCalled();
  });

  it('cancels ordinary selection without opening a workflow', async () => {
    vi.mocked(prompts).mockResolvedValue({});
    await setupCommand(args({ known: undefined }));
    expect(run).not.toHaveBeenCalled();
  });

  it('reports prerequisite failure without apply', async () => {
    run.mockResolvedValue({ status: 'invalid_input', error: 'Install codegraph or pass --executable.', warnings: [] });
    await expect(setupKnownServer(args())).rejects.toThrow('Install codegraph or pass --executable.');
    expect(run).toHaveBeenCalledOnce();
  });

  it('prompts only for a missing executable before confirming setup', async () => {
    run.mockResolvedValueOnce({
      status: 'invalid_input',
      fieldErrors: { executable: ['Missing executable'] },
      warnings: [],
    });
    vi.mocked(prompts)
      .mockResolvedValueOnce({ executable: '/tools/codegraph' })
      .mockResolvedValueOnce({ confirmed: true });
    await setupKnownServer(args({ interactive: true }));
    expect(run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'apply',
        source: expect.objectContaining({ executable: '/tools/codegraph' }),
      }),
    );
    expect(prompts).toHaveBeenCalledTimes(2);
  });

  it('does not ask for missing prerequisites in a dry run', async () => {
    run.mockResolvedValue({
      status: 'invalid_input',
      fieldErrors: { executable: ['Missing executable'] },
      warnings: [],
    });
    await expect(setupKnownServer(args({ interactive: true, dryRun: true }))).rejects.toThrow('Missing executable');
    expect(prompts).not.toHaveBeenCalled();
  });

  it('does not apply or prompt when the existing configuration is equivalent', async () => {
    run.mockResolvedValue({ status: 'unchanged', targetName: 'codegraph', warnings: [] });
    await setupKnownServer(args({ interactive: true }));
    expect(run).toHaveBeenCalledOnce();
    expect(prompts).not.toHaveBeenCalled();
    expect(printer.success).toHaveBeenCalledWith(expect.stringContaining('Unchanged'));
  });

  it('does not report success when apply conflicts after preview', async () => {
    run
      .mockResolvedValueOnce({ status: 'preview', setupFingerprint: 'confirmed-snapshot', warnings: [] })
      .mockResolvedValueOnce({ status: 'exists', error: 'Configuration changed', warnings: [] });
    await expect(setupKnownServer(args())).rejects.toThrow('Configuration changed');
    expect(run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'apply',
        expectedSetupFingerprint: 'confirmed-snapshot',
      }),
    );
    expect(printer.success).not.toHaveBeenCalled();
  });
});
