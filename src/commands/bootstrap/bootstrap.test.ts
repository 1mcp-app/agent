import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { getRuntimeParentEnvironment } from '@src/config/runtimeBootstrap.js';

import { describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import {
  BOOTSTRAP_INPUT_LIMIT,
  BOOTSTRAP_INSTRUCTIONS_ADVISORY_THRESHOLD,
  bootstrapCommand,
  buildInstructionsArguments,
  readBootstrapInput,
  renderBootstrapContext,
  runInstructionsProcess,
} from './bootstrap.js';

describe('worker bootstrap client contracts', () => {
  it.each([
    ['codex', 'SessionStart'],
    ['codex', 'SubagentStart'],
    ['claude', 'SessionStart'],
    ['claude', 'SubagentStart'],
  ] as const)(
    'delivers preparation recovery in %s %s context, advisory, and runtime fallback',
    async (client, event) => {
      for (const scenario of ['short', 'large', 'unavailable']) {
        const instructions =
          scenario === 'large'
            ? 'x'.repeat(BOOTSTRAP_INSTRUCTIONS_ADVISORY_THRESHOLD + 1)
            : 'Selected runtime instructions';
        const output = await renderBootstrapContext(
          { client, event, project: ['/selected'] },
          JSON.stringify({ hook_event_name: event }),
          async () => {
            if (scenario === 'unavailable') throw new Error('Runtime unavailable');
            return instructions;
          },
        );
        expect(output).toContain('1mcp project prepare inspect <backend>');
        expect(output).toContain('1mcp project prepare start <backend>');
        expect(output).toContain('never executes or replays the original tool call');
        expect(output).toContain('do not run `1mcp instructions` again');
        if (scenario === 'unavailable') {
          expect(output).toContain('coverage gap');
          continue;
        }
        expect(output).toContain(instructions);
        expect(output).not.toContain('coverage gap');
        expect(output.includes('PRESET ADVISORY')).toBe(scenario === 'large');
      }
    },
  );

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
    expect(output).toContain('1mcp project prepare inspect <backend>');
    expect(output).toContain('assigned --project/--project-set');
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

  it('rejects an assignment exceeding the schema limit before runtime use', async () => {
    const render = vi.fn();
    const output = await renderBootstrapContext(
      { client: 'codex', event: 'SubagentStart', project: [`/${'x'.repeat(10000)}`] },
      '',
      render,
    );
    expect(output).toContain('coverage gap');
    expect(render).not.toHaveBeenCalled();
  });

  it.each(['project', 'project-set'] as const)(
    'preserves the complete escaped %s assignment without an advisory for short instructions',
    async (selector) => {
      const project = `/${Array(16).fill('"'.repeat(250)).join('/')}`;
      const render = vi.fn(async () => 'Instructions');
      const options = {
        client: 'claude' as const,
        event: 'SubagentStart' as const,
        ...(selector === 'project' ? { project: [project] } : { 'project-set': project }),
      };
      const output = await renderBootstrapContext(options, '', render);
      expect(output.length).toBeGreaterThan(BOOTSTRAP_INSTRUCTIONS_ADVISORY_THRESHOLD);
      const assignmentLine = output
        .split('\n')
        .find((line) => line.startsWith('Explicit Worker Project Assignment: '))!;
      expect(JSON.parse(assignmentLine.slice('Explicit Worker Project Assignment: '.length))).toEqual(
        selector === 'project' ? [project] : { projectSet: project },
      );
      expect(output).toContain('Instructions');
      expect(output).not.toContain('PRESET ADVISORY');
      expect(output).not.toContain('coverage gap');
      expect(render).toHaveBeenCalledWith(options);
    },
  );

  it.each([8999, 9000, 9001])(
    'delivers all %i instruction characters with an advisory only above the threshold',
    async (length) => {
      // Astral characters ensure the threshold uses JavaScript string length, not bytes or code points.
      const instructions = '🚀'.repeat(Math.floor(length / 2)) + 'x'.repeat(length % 2);
      expect(instructions.length).toBe(length);
      const output = await renderBootstrapContext(
        { client: 'codex', event: 'SessionStart' },
        '',
        async () => instructions,
      );
      expect(output).toContain(instructions);
      expect(output).not.toContain('coverage gap');
      expect(output.split('=== PRESET ADVISORY FOR THE AGENT ===').length - 1).toBe(length > 9000 ? 1 : 0);
      if (length > 9000) {
        expect(output.indexOf('=== PRESET ADVISORY')).toBeGreaterThan(output.indexOf(instructions));
        expect(output).toContain('Inform the user briefly');
        expect(output).toContain('1mcp instructions --preset <name>');
        expect(output).toContain('All instructions have been delivered; continue the current task.');
        expect(output).toContain("Do not change the user's configuration automatically.");
      }
    },
  );

  it.each([
    ['codex', 'SessionStart'],
    ['codex', 'SubagentStart'],
    ['claude', 'SessionStart'],
    ['claude', 'SubagentStart'],
  ] as const)('delivers large instructions and an escaped assignment through the %s %s hook', async (client, event) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bootstrap-large-'));
    const entry = path.join(directory, 'instructions.mjs');
    const instructions = 'Server instructions: 工具 🚀\n'.repeat(2000) + 'END OF INSTRUCTIONS';
    const project = `/${Array(16).fill('"'.repeat(250)).join('/')}`;
    await fs.writeFile(entry, `process.stdout.write(${JSON.stringify(instructions)});`);
    const input = Readable.from([JSON.stringify({ hook_event_name: event })]);
    const stdin = vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as typeof process.stdin);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const previousEntry = process.argv[1];
    process.argv[1] = entry;
    try {
      await bootstrapCommand({ client, event, project: [project] });
      expect(stdout).toHaveBeenCalledTimes(1);
      const envelope = JSON.parse(String(stdout.mock.calls[0][0]));
      expect(envelope.hookSpecificOutput.hookEventName).toBe(event);
      const context = envelope.hookSpecificOutput.additionalContext;
      expect(context).toContain(instructions);
      expect(context).toContain(`Explicit Worker Project Assignment: ${JSON.stringify([project])}`);
      expect(context.split('=== PRESET ADVISORY FOR THE AGENT ===')).toHaveLength(2);
      expect(context).not.toContain('coverage gap');
    } finally {
      process.argv[1] = previousEntry;
      stdin.mockRestore();
      stdout.mockRestore();
      await fs.rm(directory, { recursive: true, force: true });
    }
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

  it('reports unavailable runtime without claiming delivery', async () => {
    const options = { client: 'claude', event: 'SessionStart' } as const;
    const failed = await renderBootstrapContext(options, '', async () => {
      throw new Error('private secret');
    });
    expect(failed).toContain('coverage gap');
    expect(failed).not.toContain('private secret');
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
  it('reports failed and empty subprocess output', async () => {
    await expect(runInstructionsProcess(process.execPath, ['-e', 'process.exit(2)'])).rejects.toThrow('failed');
    await expect(runInstructionsProcess(process.execPath, ['-e', ''])).rejects.toThrow('no instructions');
  });
  it('preserves subprocess output above 32 KiB including Unicode across writes', async () => {
    const instructions = '工具 🚀'.repeat(10000) + 'END';
    const output = await runInstructionsProcess(process.execPath, [
      '-e',
      "const data = Buffer.from('工具 🚀'.repeat(10000) + 'END'); process.stdout.write(data.subarray(0, 1)); setTimeout(() => process.stdout.write(data.subarray(1)), 10);",
    ]);
    expect(Buffer.byteLength(instructions)).toBeGreaterThan(32 * 1024);
    expect(output).toBe(instructions);
  });
});
