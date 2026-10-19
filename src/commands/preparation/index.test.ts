import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupProjectCommands } from '../project/index.js';

const preparationCommand = vi.hoisted(() => vi.fn());
vi.mock('./preparation.js', () => ({ preparationCommand }));
vi.mock('@src/logger/configureGlobalLogger.js', () => ({ configureGlobalLogger: vi.fn() }));

async function parse(args: string[]) {
  return setupProjectCommands(yargs([]).exitProcess(false).help().version(false).strict())
    .showHelpOnFail(false)
    .parseAsync(['project', ...args]);
}

afterEach(() => vi.clearAllMocks());

describe('prepare command family', () => {
  it.each(['preparation', 'preparation inspect source-search'])(
    'rejects removed compatibility entry point %s',
    async (command) => {
      await expect(parse(command.split(' '))).rejects.toThrow();
      expect(preparationCommand).not.toHaveBeenCalled();
    },
  );

  it.each(['prepare', 'preparation'])('rejects removed root command %s', async (command) => {
    const parser = setupProjectCommands(yargs([]).exitProcess(false).strict()).showHelpOnFail(false);
    await expect(async () => parser.parseAsync([command, 'inspect', 'source-search'])).rejects.toThrow();
    expect(preparationCommand).not.toHaveBeenCalled();
  });

  it('advertises the project group and nested preparation family without invoking work', async () => {
    const outputs: string[] = [];
    for (const args of [['--help'], ['project', '--help']]) {
      await setupProjectCommands(yargs([]).scriptName('1mcp').exitProcess(false).help().version(false)).parseAsync(
        args,
        {},
        (_error, _argv, help) => {
          outputs.push(help.replace(/\s+/g, ' '));
        },
      );
    }
    expect(outputs[0]).toContain('1mcp project');
    expect(outputs[0]).not.toContain('1mcp prepare');
    expect(outputs[0]).not.toContain('1mcp preparation');
    expect(outputs[1]).toContain('1mcp project prepare');
    expect(preparationCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['prepare', 'source-search'],
    ['prepare', 'start', 'source-search'],
  ])('requests preparation with %j', async (...args) => {
    await parse(args);
    expect(preparationCommand).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: 'prepare', backend: 'source-search' }),
    );
  });

  it.each(['inspect', 'status', 'wait', 'cancel', 'retry'])('supports %s', async (action) => {
    const id = '00000000-0000-4000-8000-000000000001';
    const tail = action === 'inspect' ? [] : [id];
    const selection = [
      '--project',
      '/selected',
      '--context',
      'local',
      '--url',
      'http://localhost:3050',
      '--operation',
      'lookup',
      '--preset',
      'code',
      '--tags',
      'source',
      '--format',
      'json',
    ];
    if (action === 'wait') selection.push('--wait-ms', '5000');
    await parse(['prepare', action, 'source-search', ...tail, ...selection]);
    expect(preparationCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action,
        backend: 'source-search',
        ...(tail.length ? { id } : {}),
        project: ['/selected'],
        context: 'local',
        url: 'http://localhost:3050',
        operation: 'lookup',
        preset: 'code',
        tags: ['source'],
        format: 'json',
        ...(action === 'wait' ? { 'wait-ms': 5000 } : {}),
      }),
    );
  });

  it.each(['start', 'inspect', 'status', 'wait', 'cancel', 'retry'])(
    'addresses backend named %s explicitly',
    async (backend) => {
      await parse(['prepare', 'start', backend]);
      expect(preparationCommand).toHaveBeenCalledWith(expect.objectContaining({ action: 'prepare', backend }));
    },
  );

  it.each(['status', 'retry'])('allows %s without a job id', async (action) => {
    await parse(['prepare', action, 'source-search']);
    expect(preparationCommand).toHaveBeenCalledWith(expect.objectContaining({ action, backend: 'source-search' }));
  });

  it.each([
    ['prepare'],
    ['prepare', 'start'],
    ['prepare', 'inspect'],
    ['prepare', 'wait', 'source-search'],
    ['prepare', 'cancel', 'source-search'],
    ['prepare', 'source-search', 'extra'],
    ['prepare', 'start', 'source-search', 'extra'],
    ['prepare', 'inspect', 'source-search', 'extra'],
    ['preparation', 'unknown', 'source-search'],
    ['prepare', 'source-search', '--unknown'],
  ])('rejects invalid arguments %j before invocation', async (...args) => {
    await expect(parse(args)).rejects.toThrow();
    expect(preparationCommand).not.toHaveBeenCalled();
  });

  it('shows controls and start in prepare help without invoking work', async () => {
    let output = '';
    await setupProjectCommands(yargs([]).exitProcess(false).help().version(false)).parseAsync(
      ['project', 'prepare', '--help'],
      (_error: Error | undefined, _argv: unknown, help: string) => {
        output = help;
      },
    );
    for (const action of ['start', 'inspect', 'status', 'wait', 'cancel', 'retry']) expect(output).toContain(action);
    expect(preparationCommand).not.toHaveBeenCalled();
  });
});
