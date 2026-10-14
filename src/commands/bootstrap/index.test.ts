import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupBootstrapCommand } from './index.js';

const command = vi.hoisted(() => vi.fn());
vi.mock('./bootstrap.js', () => ({ bootstrapCommand: command }));

describe('bootstrap CLI registration', () => {
  beforeEach(() => command.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['codex', 'SessionStart'],
    ['codex', 'SubagentStart'],
    ['claude', 'SessionStart'],
    ['claude', 'SubagentStart'],
  ])('routes %s %s with its literal project assignment', async (client, event) => {
    const cli = setupBootstrapCommand(yargs().exitProcess(false).strict());
    await cli.parseAsync(['bootstrap', '--client', client, '--event', event, '--project', '/worker/a;$(literal)']);
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ client, event, project: ['/worker/a;$(literal)'] }));
  });

  it('rejects unsupported events before invoking bootstrap', async () => {
    const cli = setupBootstrapCommand(
      yargs()
        .exitProcess(false)
        .strict()
        .fail((message) => {
          throw new Error(message);
        }),
    );
    await expect(
      Promise.resolve().then(() => cli.parseAsync(['bootstrap', '--client', 'codex', '--event', 'Stop'])),
    ).rejects.toThrow('Invalid values');
    expect(command).not.toHaveBeenCalled();
  });

  it('passes repeated labels alongside the explicit project-set definition', async () => {
    const cli = setupBootstrapCommand(yargs().exitProcess(false).strict());
    await cli.parseAsync([
      'bootstrap',
      '--client',
      'claude',
      '--event',
      'SubagentStart',
      '--project-set',
      '/sets/feature.json',
      '--project',
      'backend',
      '--project',
      'frontend',
    ]);
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        'project-set': '/sets/feature.json',
        project: ['backend', 'frontend'],
      }),
    );
  });

  it('ignores inherited environment assignments for bare worker hooks', async () => {
    vi.stubEnv('ONE_MCP_PROJECT', '/parent');
    vi.stubEnv('ONE_MCP_PROJECT_SET', '/parent-set.json');
    const cli = setupBootstrapCommand(yargs().env('ONE_MCP').exitProcess(false).strict());
    await cli.parseAsync(['bootstrap', '--client', 'codex', '--event', 'SubagentStart']);
    const options = command.mock.calls[0][0];
    expect(options.project).toBeUndefined();
    expect(options['project-set']).toBeUndefined();
    const { renderBootstrapContext } = await vi.importActual<typeof import('./bootstrap.js')>('./bootstrap.js');
    const render = vi.fn();
    expect(await renderBootstrapContext(options, '', render)).toContain('Worker Project Assignment unresolved');
    expect(render).not.toHaveBeenCalled();
  });

  it('honors explicit worker flags while ignoring inherited environment selectors', async () => {
    vi.stubEnv('ONE_MCP_PROJECT', '/parent');
    vi.stubEnv('ONE_MCP_PROJECT_SET', '/parent-set.json');
    const cli = setupBootstrapCommand(yargs().env('ONE_MCP').exitProcess(false).strict());
    await cli.parseAsync(['bootstrap', '--client', 'claude', '--event', 'SubagentStart', '--project', '/worker']);
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ project: ['/worker'] }));
    expect(command.mock.calls[0][0]['project-set']).toBeUndefined();
  });
});
