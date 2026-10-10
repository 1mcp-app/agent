import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { getRuntimeParentEnvironment } from '@src/config/runtimeBootstrap.js';

import { describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import {
  BOOTSTRAP_CONTEXT_LIMIT,
  BOOTSTRAP_INPUT_LIMIT,
  bootstrapCommand,
  buildInstructionsArguments,
  readBootstrapInput,
  renderBootstrapContext,
  runInstructionsProcess,
} from './bootstrap.js';

describe('worker bootstrap client contracts', () => {
  it.each(['codex', 'claude'] as const)('ignores %s parent cwd and undocumented assignment fields', async (client) => {
    const render = vi.fn();
    const output = await renderBootstrapContext(
      { client, event: 'SubagentStart' },
      JSON.stringify({
        hook_event_name: 'SubagentStart',
        session_id: 'parent',
        cwd: '/parent',
        agent_id: 'worker',
        agent_type: 'Explore',
        project: '/invented',
        assignment: { project: '/invented' },
      }),
      render,
    );
    expect(render).not.toHaveBeenCalled();
    expect(output).toContain('Worker Project Assignment unresolved');
    expect(output).not.toContain('/parent');
    expect(output).not.toContain('/invented');
    expect(output).toContain('inspect <server>/<tool>');
  });

  it.each(['codex', 'claude'] as const)('emits a documented %s additionalContext envelope', async (client) => {
    const input = Readable.from([JSON.stringify({ hook_event_name: 'SubagentStart', cwd: '/parent' })]);
    const stdin = vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as typeof process.stdin);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      await bootstrapCommand({ client, event: 'SubagentStart' });
      const output = JSON.parse(String(stdout.mock.calls[0][0]));
      expect(Object.keys(output)).toEqual(['hookSpecificOutput']);
      expect(output.hookSpecificOutput.hookEventName).toBe('SubagentStart');
      expect(output.hookSpecificOutput.additionalContext).toContain('Worker Project Assignment unresolved');
    } finally {
      stdin.mockRestore();
      stdout.mockRestore();
    }
  });

  it.each(['tty', 'empty-open-pipe', 'partial-open-pipe', 'oversized', 'invalid-json'] as const)(
    'handles a manual explicit assignment with %s stdin without inventing hook input',
    async (inputKind) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bootstrap-stdin-'));
      const entry = path.join(directory, 'instructions.mjs');
      const invoked = path.join(directory, 'invoked');
      await fs.writeFile(
        entry,
        `import {writeFileSync} from 'node:fs';
        writeFileSync(${JSON.stringify(invoked)}, 'invoked');
        if(!process.argv.includes('--project=/worker'))process.exit(2);
        process.stdout.write('Verified instructions for explicit worker');`,
      );
      const input = new PassThrough();
      if (inputKind === 'tty') Object.assign(input, { isTTY: true });
      if (inputKind === 'partial-open-pipe') input.write('{"hook_event_name":');
      if (inputKind === 'oversized') input.write('x'.repeat(BOOTSTRAP_INPUT_LIMIT + 1));
      if (inputKind === 'invalid-json') input.end('not json');
      const resume = vi.spyOn(input, 'resume');
      const stdin = vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as typeof process.stdin);
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const previousEntry = process.argv[1];
      process.argv[1] = entry;
      try {
        await bootstrapCommand({ client: 'codex', event: 'SubagentStart', project: ['/worker'] });
        const context = JSON.parse(String(stdout.mock.calls[0][0])).hookSpecificOutput.additionalContext;
        if (inputKind === 'tty' || inputKind === 'empty-open-pipe') {
          expect(context).toContain('Explicit Worker Project Assignment: ["/worker"]');
          expect(context).toContain('Verified instructions for explicit worker');
          expect(context).not.toContain('could not be verified');
          expect(await fs.readFile(invoked, 'utf8')).toBe('invoked');
        } else {
          expect(context).toContain('could not be verified');
          expect(context).not.toContain('Verified instructions for explicit worker');
          await expect(fs.access(invoked)).rejects.toThrow();
        }
        if (inputKind === 'tty') expect(resume).not.toHaveBeenCalled();
        expect(input.listenerCount('data')).toBe(0);
        expect(input.listenerCount('end')).toBe(0);
        expect(input.listenerCount('error')).toBe(0);
      } finally {
        process.argv[1] = previousEntry;
        stdin.mockRestore();
        stdout.mockRestore();
        resume.mockRestore();
        input.destroy();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('bounds an oversized assignment before it can expand hook output', async () => {
    const render = vi.fn();
    const output = await renderBootstrapContext(
      { client: 'codex', event: 'SubagentStart', project: [`/${'x'.repeat(10000)}`] },
      '',
      render,
    );
    expect(output).toContain('coverage gap');
    expect(output.length).toBeLessThan(BOOTSTRAP_CONTEXT_LIMIT);
    expect(render).not.toHaveBeenCalled();
  });

  it.each(['project', 'project-set'] as const)(
    'budgets the escaped %s assignment with complete recovery guidance',
    async (selector) => {
      const project = `/${Array(16).fill('"'.repeat(250)).join('/')}`;
      expect(project.length).toBe(4016);
      const render = vi.fn(async () => 'Instructions');
      const output = await renderBootstrapContext(
        {
          client: 'claude',
          event: 'SubagentStart',
          ...(selector === 'project' ? { project: [project] } : { 'project-set': project }),
        },
        '',
        render,
      );
      expect(output.length).toBeLessThanOrEqual(BOOTSTRAP_CONTEXT_LIMIT);
      expect(output).toContain('escaped assignment exceeds');
      expect(output).toContain('Worker Project Assignment unresolved');
      expect(output).toContain('original assignment from dispatch');
      expect(output).toContain('--project or --project-set');
      expect(output).not.toContain(project);
      expect(output).not.toContain('Explicit Worker Project Assignment:');
      expect(render).not.toHaveBeenCalled();
      const envelope = JSON.parse(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: output } }),
      );
      expect(envelope.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(BOOTSTRAP_CONTEXT_LIMIT);
    },
  );

  it('reserves room for the fallback even when the escaped prefix alone fits', async () => {
    const render = vi.fn(async () => 'x'.repeat(BOOTSTRAP_CONTEXT_LIMIT));
    const short = await renderBootstrapContext(
      { client: 'claude', event: 'SubagentStart', project: ['/'] },
      '',
      async () => '',
    );
    // Two output characters per quote: leave less space than the fallback requires.
    const project = `/${'"'.repeat(Math.floor((BOOTSTRAP_CONTEXT_LIMIT - short.length - 30) / 2))}`;
    const output = await renderBootstrapContext(
      { client: 'claude', event: 'SubagentStart', project: [project] },
      '',
      render,
    );
    expect(output.length).toBeLessThanOrEqual(BOOTSTRAP_CONTEXT_LIMIT);
    expect(output).toContain('escaped assignment exceeds');
    expect(render).not.toHaveBeenCalled();
  });

  it('delivers different explicit assignments independently, including repeat deliveries', async () => {
    const render = vi.fn(async (options) => `Instructions for ${options.project}`);
    for (const project of ['/frontend', '/backend', '/frontend']) {
      const output = await renderBootstrapContext(
        { client: 'codex', event: 'SubagentStart', project: [project] },
        '{"hook_event_name":"SubagentStart","cwd":"/parent"}',
        render,
      );
      expect(output).toContain(`Instructions for ${project}`);
      expect(output).not.toContain('unresolved');
    }
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('passes explicit project-set assignment without guessing a member', async () => {
    const render = vi.fn(async () => 'Selected set');
    const options = { client: 'claude', event: 'SubagentStart', 'project-set': '/sets/feature.json' } as const;
    expect(await renderBootstrapContext(options, '', render)).toContain('/sets/feature.json');
    expect(render).toHaveBeenCalledWith(options);
    expect(buildInstructionsArguments(options)).toEqual(['instructions', '--project-set=/sets/feature.json']);
  });

  it('preserves ordered repeated label selectors in argv and serialized worker handoff', async () => {
    const options = {
      client: 'codex' as const,
      event: 'SubagentStart' as const,
      'project-set': '/sets/feature.json',
      project: ['backend', 'front"end'],
    };
    expect(buildInstructionsArguments(options)).toEqual([
      'instructions',
      '--project=backend',
      '--project=front"end',
      '--project-set=/sets/feature.json',
    ]);
    const render = vi.fn(async () => 'Selected members');
    const output = await renderBootstrapContext(options, '{"hook_event_name":"SubagentStart","cwd":"/parent"}', render);
    const selectionLine = output.split('\n').find((line) => line.startsWith('Explicit Worker Project Assignment: '))!;
    expect(JSON.parse(selectionLine.slice('Explicit Worker Project Assignment: '.length))).toEqual({
      projectSet: '/sets/feature.json',
      selection: ['backend', 'front"end'],
    });
    expect(render).toHaveBeenCalledWith(options);
  });

  it('renders ordinary SessionStart instructions through the runtime', async () => {
    const output = await renderBootstrapContext(
      { client: 'claude', event: 'SessionStart' },
      '{"hook_event_name":"SessionStart","source":"startup"}',
      async () => 'Current servers',
    );
    expect(output).toContain('Current servers');
  });

  it.each(['no json', '{"hook_event_name":"SessionStart"}', '[]'])('reports invalid worker input %s', async (input) => {
    const render = vi.fn();
    const output = await renderBootstrapContext(
      { client: 'codex', event: 'SubagentStart', project: ['/worker'] },
      input,
      render,
    );
    expect(output).toContain('Bootstrap coverage gap');
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects ambiguous and relative assignments before runtime use', async () => {
    const render = vi.fn();
    for (const selection of [{ project: ['relative'] }, { project: ['/worker', '/other'] }]) {
      expect(
        await renderBootstrapContext({ client: 'codex', event: 'SubagentStart', ...selection }, '', render),
      ).toContain('coverage gap');
    }
    expect(render).not.toHaveBeenCalled();
  });

  it('reports unavailable runtime and excessive client context without claiming delivery', async () => {
    const options = { client: 'claude', event: 'SessionStart' } as const;
    const failed = await renderBootstrapContext(options, '', async () => {
      throw new Error('private secret');
    });
    expect(failed).toContain('coverage gap');
    expect(failed).not.toContain('private secret');
    const excessive = await renderBootstrapContext(options, '', async () => 'x'.repeat(BOOTSTRAP_CONTEXT_LIMIT));
    expect(excessive.length).toBeLessThan(BOOTSTRAP_CONTEXT_LIMIT);
    expect(excessive).toContain('exceed the client context budget');
  });

  it('bounds stdin bytes and waiting', async () => {
    expect(await readBootstrapInput(Readable.from(['{}']))).toBe('{}');
    await expect(readBootstrapInput(Readable.from(['x'.repeat(BOOTSTRAP_INPUT_LIMIT + 1)]))).rejects.toThrow('64 KiB');
    const stalled = new PassThrough();
    stalled.write('{');
    await expect(readBootstrapInput(stalled, 20)).rejects.toThrow('deadline');
    expect(stalled.listenerCount('data')).toBe(0);
    stalled.destroy();
  });

  it('treats a zero-byte open pipe deadline as empty and detaches its listeners', async () => {
    const input = new PassThrough();
    try {
      expect(await readBootstrapInput(input, 20)).toBe('');
      expect(input.listenerCount('data')).toBe(0);
      expect(input.listenerCount('end')).toBe(0);
      expect(input.listenerCount('error')).toBe(0);
      expect(input.isPaused()).toBe(true);
    } finally {
      input.destroy();
    }
  });
});

describe('owned instructions subprocess', () => {
  it('keeps every forwarded flaglike value inside its option when parsed by yargs', async () => {
    const values = {
      client: 'codex' as const,
      event: 'SubagentStart' as const,
      project: ['--help', '--version', 'frontend'],
      'project-set': '--saved.json',
      url: '--runtime',
      context: '--context',
      preset: '--preset',
      'tag-filter': '--filter',
      config: '--config.json',
      'config-dir': '--config-dir',
      tags: ['--help', '--version', 'backend'],
    };
    const handler = vi.fn();
    const cli = yargs()
      .exitProcess(false)
      .help()
      .version('test-version')
      .strict()
      .command(
        'instructions',
        '',
        (command) => {
          let configured = command
            .option('project', { type: 'array', string: true })
            .option('tags', { type: 'array', string: true });
          for (const key of ['project-set', 'url', 'context', 'preset', 'tag-filter', 'config', 'config-dir']) {
            configured = configured.option(key, { type: 'string' });
          }
          return configured;
        },
        handler,
      );
    await cli.parseAsync(buildInstructionsArguments(values));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        project: values.project,
        'project-set': values['project-set'],
        url: values.url,
        context: values.context,
        preset: values.preset,
        'tag-filter': values['tag-filter'],
        config: values.config,
        'config-dir': values['config-dir'],
        tags: values.tags,
      }),
    );
    expect(handler.mock.calls[0][0].help).not.toBe(true);
    expect(handler.mock.calls[0][0].version).not.toBe(true);
  });
  it('strips inherited selectors from the child without mutating the parent or unrelated environment', async () => {
    vi.stubEnv('ONE_MCP_PROJECT', '/parent');
    vi.stubEnv('ONE_MCP_PROJECT_SET', '/parent-set.json');
    vi.stubEnv('ONE_MCP_BOOTSTRAP_TEST_MARKER', 'preserved');
    try {
      const output = await runInstructionsProcess(process.execPath, [
        '-e',
        'process.stdout.write(JSON.stringify({project:process.env.ONE_MCP_PROJECT,projectSet:process.env.ONE_MCP_PROJECT_SET,marker:process.env.ONE_MCP_BOOTSTRAP_TEST_MARKER}))',
      ]);
      expect(JSON.parse(output)).toEqual({ marker: 'preserved' });
      expect(getRuntimeParentEnvironment().ONE_MCP_PROJECT).toBe('/parent');
      expect(getRuntimeParentEnvironment().ONE_MCP_PROJECT_SET).toBe('/parent-set.json');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('uses literal argv for shell metacharacters', async () => {
    const value = '/worker/$(touch NEVER); spaces';
    const output = await runInstructionsProcess(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1])',
      value,
    ]);
    expect(output).toBe(value);
  });
  it('terminates a stalled child within the deadline', async () => {
    const start = Date.now();
    await expect(runInstructionsProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 100)).rejects.toThrow(
      'deadline',
    );
    expect(Date.now() - start).toBeLessThan(1500);
  });
  it('reports failed, empty, and excessive subprocess output', async () => {
    await expect(runInstructionsProcess(process.execPath, ['-e', 'process.exit(2)'])).rejects.toThrow('failed');
    await expect(runInstructionsProcess(process.execPath, ['-e', ''])).rejects.toThrow('no instructions');
    await expect(
      runInstructionsProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(40000))']),
    ).rejects.toThrow('output limit');
  });
});
