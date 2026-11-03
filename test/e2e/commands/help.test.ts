import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const commandPaths = [
  '',
  'serve',
  'proxy',
  'bootstrap',
  'cli-setup',
  'instructions',
  'inspect',
  'run',
  'wait',
  ...['', 'bootstrap', 'login', 'status', 'logout'].map((sub) => `admin ${sub}`.trim()),
  ...['', 'consolidate', 'restore', 'list', 'discover', 'status', 'backups'].map((sub) => `app ${sub}`.trim()),
  ...['', 'login', 'status', 'logout', 'export-oauth-credentials', 'export-upstream-credentials'].map((sub) =>
    `auth ${sub}`.trim(),
  ),
  ...[
    '',
    'add',
    'setup',
    'install',
    'remove',
    'uninstall',
    'update',
    'enable',
    'disable',
    'restart',
    'list',
    'status',
    'tokens',
    'search',
    'tools',
    'tools list',
    'tools disable',
    'tools enable',
  ].map((sub) => `mcp ${sub}`.trim()),
  ...['', 'edit', 'create', 'show', 'list', 'url', 'delete', 'test'].map((sub) => `preset ${sub}`.trim()),
  ...['', 'start', 'inspect', 'status', 'wait', 'cancel', 'retry'].map((sub) => `project prepare ${sub}`.trim()),
  'project',
  'project prepare example',
  ...['', 'search', 'status', 'show', 'versions'].map((sub) => `registry ${sub}`.trim()),
  ...['', 'add', 'use', 'export', 'import', 'doctor', 'current', 'list', 'inspect', 'delete', 'rename', 'verify'].map(
    (sub) => `target ${sub}`.trim(),
  ),
];

describe('CLI help', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeAll(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('help', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });
  afterAll(async () => {
    await environment.cleanup();
  });

  it.each(commandPaths)('shows help without executing %s', async (path) => {
    const [command, ...args] = path ? path.split(' ') : ['--help'];
    const result = await runner.runCommand(command, '', { args: [...args, '--help'], timeout: 10000 });
    runner.assertSuccess(result);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('1mcp');
    expect(result.stdout).toContain('--help');
    expect(result.stdout).not.toContain('index.js');
    expect(result.stdout).not.toContain('-c, -c');
    expect(result.stdout.match(/"debug"/g)).toHaveLength(1);
    expect(result.stdout).not.toContain('\u001b[');
  });

  it.each([
    'serve',
    'project recover',
    'registry status',
    'registry search query',
    'registry show server',
    'registry versions server',
  ])('rejects project selectors with command help before executing %s', async (command) => {
    for (const selector of ['--project', '--project-set']) {
      const args = [selector, '/work/app', ...command.split(' ')];
      const result = await runner.runCommand(args[0], '', { args: args.slice(1) });
      runner.assertFailure(result, 1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/Unknown arguments?:/);
      expect(result.stderr).toContain(selector.slice(2));
      expect(result.stderr).toContain(command.split(' ').slice(0, 2).join(' '));
    }
  });

  it('keeps root help compact and the full server reference discoverable', async () => {
    const root = await runner.runCommand('--help', '');
    expect(root.stdout.match(/Usage:/g)).toHaveLength(1);
    expect(root.stdout).toContain('1mcp serve --help');
    expect(root.stdout).toContain('Examples:');
    expect(root.stdout).not.toContain('--async-max-retries');
    expect(root.stdout).not.toContain('--transport');
    expect(root.stdout).toContain('1mcp project');
    expect(root.stdout).not.toContain('1mcp prepare');
    expect(root.stdout).not.toContain('1mcp preparation');
    const serve = await runner.runCommand('serve', '', { args: ['--help'] });
    for (const group of [
      'Runtime:',
      'Transport:',
      'Security:',
      'Filtering:',
      'Loading:',
      'Sessions:',
      'Configuration:',
      'Deprecated options:',
    ]) {
      expect(serve.stdout).toContain(group);
    }
    expect(serve.stdout).toContain('--async-max-retries');
    expect(serve.stdout).not.toContain('--runtime-owner-claim-id');
    expect(serve.stdout).not.toContain('--background-bootstrap');
  });

  it.each(['mcp', 'mcp tools', 'registry', 'app', 'serve'])('preserves -h for %s', async (path) => {
    const [command, ...args] = path.split(' ');
    const short = await runner.runCommand(command, '', { args: [...args, '-h'] });
    const long = await runner.runCommand(command, '', { args: [...args, '--help'] });
    runner.assertSuccess(short);
    expect(short.stdout).toBe(long.stdout);
  });

  it('keeps invalid commands on stderr with nonzero status', async () => {
    const result = await runner.runCommand('not-a-command', '');
    runner.assertFailure(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown');
    expect(result.stderr).toContain('1mcp');
  });

  it('rejects an unadvertised release wait budget before contacting a runtime', async () => {
    const help = await runner.runCommand('project', 'release', { args: ['--help'] });
    runner.assertSuccess(help);
    expect(help.stdout).not.toContain('--wait-ms');
    const result = await runner.runCommand('project', 'release', { args: ['--wait-ms', '5000'] });
    runner.assertFailure(result, 1);
    expect(result.stderr).toContain('Unknown arguments');
    expect(result.stderr).toContain('wait-ms');
  });

  it('delivers a categorized bootstrap gap without echoing invalid hook input', async () => {
    const result = await runner.runCommand('bootstrap', '', {
      args: ['--client', 'codex', '--event', 'SubagentStart'],
      input: 'private invalid hook input',
    });
    runner.assertSuccess(result);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    expect(context).toContain('Bootstrap coverage gap [invalid_hook_input]');
    expect(context).not.toContain('private invalid hook input');
  });

  it.each(['prepare', 'preparation'])('rejects removed root command %s', async (command) => {
    const result = await runner.runCommand(command, '', { args: ['inspect', 'example'] });
    runner.assertFailure(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown');
  });

  it('preserves errors and command help from rejected async handlers', async () => {
    const result = await runner.runCommand('mcp', 'update', { args: ['example', '--'] });
    runner.assertFailure(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('No command specified after " -- "');
    expect(result.stderr).toContain('1mcp mcp update <name>');
  });

  it('accepts legacy root flags and suppresses color in redirected help', async () => {
    const result = await runner.runCommand('--transport', 'stdio', {
      args: ['--port', '3051', '-h'],
      envOverrides: { NO_COLOR: '1' },
    });
    runner.assertSuccess(result);
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stderr).toBe('');
  });
});
