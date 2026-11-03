import { setupBootstrapCommand } from '@src/commands/bootstrap/index.js';
import { setupInspectCommand } from '@src/commands/inspect/index.js';
import { setupInstructionsCommand } from '@src/commands/instructions/index.js';
import { setupMcpCommands } from '@src/commands/mcp/index.js';
import { setupProjectCommands } from '@src/commands/project/index.js';
import { setupProxyCommand } from '@src/commands/proxy/index.js';
import { setupRegistryCommands } from '@src/commands/registry/index.js';
import { setupRunCommand } from '@src/commands/run/index.js';
import { setupServeCommand } from '@src/commands/serve/index.js';
import { setupTargetCommands } from '@src/commands/target/index.js';
import { setupWaitCommand } from '@src/commands/wait/index.js';
import { withGlobalOptions } from '@src/globalOptions.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@src/commands/shared/commandRunner.js', () => ({ runCliCommand: invoke }));
vi.mock('@src/logger/configureGlobalLogger.js', () => ({ configureGlobalLogger: vi.fn() }));
vi.mock('@src/commands/bootstrap/bootstrap.js', () => ({ bootstrapCommand: invoke }));
vi.mock('@src/commands/proxy/proxy.js', () => ({ proxyCommand: invoke }));
vi.mock('@src/commands/serve/serve.js', () => ({ serveCommand: invoke }));
vi.mock('@src/commands/instructions/instructions.js', () => ({ instructionsCommand: vi.fn() }));
vi.mock('@src/commands/inspect/inspect.js', () => ({ inspectCommand: vi.fn() }));
vi.mock('@src/commands/run/run.js', () => ({ runCommand: vi.fn() }));
vi.mock('@src/commands/wait/wait.js', () => ({ waitCommand: vi.fn() }));
vi.mock('@src/commands/project/project.js', () => ({ projectCommand: vi.fn() }));
vi.mock('@src/commands/preparation/preparation.js', () => ({ preparationCommand: vi.fn() }));

vi.mock('@src/commands/registry/search.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/commands/registry/search.js')>()),
  searchCommand: invoke,
}));

vi.mock('@src/commands/registry/status.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/commands/registry/status.js')>()),
  registryStatusCommand: invoke,
}));

vi.mock('@src/commands/registry/show.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/commands/registry/show.js')>()),
  showCommand: invoke,
}));

vi.mock('@src/commands/registry/versions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/commands/registry/versions.js')>()),
  versionsCommand: invoke,
}));

function parser(onHelp: (text: string) => void = () => {}) {
  let cli = withGlobalOptions(
    yargs([])
      .exitProcess(false)
      .strict()
      .help()
      .fail((message, error, cli) => {
        cli.showHelp(onHelp);
        throw error ?? new Error(message);
      }),
  );
  for (const setup of [
    setupRegistryCommands,
    setupMcpCommands,
    setupTargetCommands,
    setupBootstrapCommand,
    setupInstructionsCommand,
    setupInspectCommand,
    setupRunCommand,
    setupProxyCommand,
    setupWaitCommand,
    setupProjectCommands,
    setupServeCommand,
  ])
    cli = setup(cli);
  return cli.command('$0', 'Default serve', {}, invoke).command('unrelated', 'Unrelated command', {}, invoke);
}

async function parse(args: string[], onHelp?: (text: string) => void) {
  return parser(onHelp).parseAsync(args);
}

const supported = [
  ['bootstrap', '--client', 'codex', '--event', 'SubagentStart'],
  ['instructions'],
  ['inspect', 'codegraph'],
  ['run', 'server/tool'],
  ['proxy'],
  ['wait', 'server'],
  ...['release', 'drain', 'status', 'resume'].map((action) => ['project', action]),
  ['project', 'prepare', 'backend'],
  ...['start', 'inspect', 'status', 'wait', 'cancel', 'retry'].map((action) => [
    'project',
    'prepare',
    action,
    'backend',
    ...(['wait', 'cancel'].includes(action) ? ['job'] : []),
  ]),
];

beforeEach(() => invoke.mockClear());

describe('command-scoped project selection', () => {
  it.each(supported.map((command) => ({ command })))(
    'accepts both positions and repeated labels: $command',
    async ({ command }) => {
      const cli = parser();
      for (const args of [
        ['--project', '/work/app', ...command],
        [...command, '--project', '/work/app'],
        ['--project', 'front', ...command, '--project', 'back', '--project-set', '/set.json'],
        ['--project-set', '/set.json', ...command, '--project', 'front', '--project', 'back'],
      ]) {
        invoke.mockClear();
        await cli.parseAsync(args);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke.mock.calls[0][0].project).toEqual(args.includes('/set.json') ? ['front', 'back'] : ['/work/app']);
      }
    },
  );

  it.each(supported.map((command) => ({ command })))(
    'rejects missing values before handlers: $command',
    async ({ command }) => {
      for (const selector of ['--project', '--project-set']) {
        await expect(parse([...command, selector])).rejects.toThrow(/Not enough arguments/);
        expect(invoke).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ['serve'],
    ['project', 'recover'],
    ['mcp', 'list'],
    ['target', 'list'],
    ['registry', 'status'],
    ['registry', 'search', 'query'],
    ['registry', 'show', 'server'],
    ['registry', 'versions', 'server'],
    ['unrelated'],
  ])('rejects selectors for %j before handlers', async (...command) => {
    for (const selector of ['--project', '--project-set']) {
      for (const args of [
        [selector, '/work/app', ...command],
        [...command, selector, '/work/app'],
      ]) {
        let output = '';
        await expect(
          parse(args, (text) => {
            output = text;
          }),
        ).rejects.toThrow(/Unknown argument/);
        expect(output).toContain(command.slice(0, 2).join(' '));
        expect(invoke).not.toHaveBeenCalled();
      }
    }
  });

  it('keeps selectors out of global help and avoids leakage across repeated parses', async () => {
    const cli = parser();
    for (const command of [['inspect'], ['serve'], ['project', 'status'], ['project', 'recover'], []]) {
      let output = '';
      await cli.parseAsync([...command, '--help'], {}, (_error, _argv, text) => {
        output = text;
      });
      const supports = command.includes('inspect') || command.includes('status');
      expect(output.includes('--project ')).toBe(supports);
      expect(output.includes('--project-set ')).toBe(supports);
      expect(output).toContain('--project-owner');
    }
  });
});
