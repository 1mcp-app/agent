import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import * as environment from './codegraphEnvironment.js';
import { resolveCodeGraphInstallation } from './codegraphInstallation.js';
import { runCodeGraphNativeWork } from './codegraphProcess.js';
import { disposeCodeGraphPreparationToolMetadata, getCodeGraphPreparationToolDefinition } from './codegraphReadOnly.js';

let fixture: string;
let executable: string;
beforeEach(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'codegraph-installation-'));
  executable = path.join(fixture, 'bin', 'codegraph');
});
afterEach(async () => {
  await disposeCodeGraphPreparationToolMetadata();
  vi.restoreAllMocks();
  await rm(fixture, { recursive: true, force: true });
});

async function metadataBundle(toolsSource: string, bundleRoot = fixture): Promise<string> {
  const binary = path.join(bundleRoot, 'bin', 'codegraph');
  await mkdir(path.join(bundleRoot, 'bin'), { recursive: true });
  await mkdir(path.join(bundleRoot, 'lib', 'dist', 'mcp'), { recursive: true });
  await writeFile(binary, '#!/bin/sh\n');
  await writeFile(path.join(bundleRoot, 'lib', 'package.json'), JSON.stringify({ version: '1.6.2' }));
  await writeFile(
    path.join(bundleRoot, 'lib', 'dist', 'index.js'),
    'throw new Error("Metadata must not load the SDK/open chain");',
  );
  await writeFile(
    path.join(bundleRoot, 'lib', 'dist', 'mcp', 'writer-lock.js'),
    'throw new Error("Metadata must not acquire ownership");',
  );
  await writeFile(path.join(bundleRoot, 'lib', 'dist', 'mcp', 'tools.js'), toolsSource);
  await symlink(process.execPath, path.join(bundleRoot, process.platform === 'win32' ? 'node.exe' : 'node'));
  return binary;
}

const nativeDefinition = {
  name: 'codegraph_explore',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};

function blockedMetadata(gate: string, started: string): string {
  return `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(started)},String(process.pid));
    while(!fs.existsSync(${JSON.stringify(gate)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
    exports.tools=${JSON.stringify([nativeDefinition])};exports.getStaticTools=()=>exports.tools;`;
}

async function existingPid(file: string): Promise<number | undefined> {
  return readFile(file, 'utf8').then(Number, () => undefined);
}

it('uses only trusted configured native visibility and coalesces distinct visibility snapshots without opening an index', async () => {
  const jobs = path.join(fixture, 'metadata-jobs');
  const definitions = [nativeDefinition, { ...nativeDefinition, name: 'codegraph_search' }];
  await metadataBundle(`
    const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(jobs)},(process.env.CODEGRAPH_MCP_TOOLS??'')+'\\n');
    exports.tools=${JSON.stringify(definitions)};
    exports.getStaticTools=()=>{
      const raw=process.env.CODEGRAPH_MCP_TOOLS;
      const visible=raw?.trim()?new Set(raw.split(',').map(value=>value.trim().replace(/^codegraph_/,''))):new Set(['explore']);
      return exports.tools.filter(tool=>visible.has(tool.name.replace(/^codegraph_/,'')));
    };
  `);
  const source = path.join(fixture, 'source.ts');
  await writeFile(source, 'export const unchanged = 1;');
  const nativeEnvironment = environment.codeGraphEnvironment();
  vi.spyOn(environment, 'codeGraphEnvironment').mockReturnValue({
    ...nativeEnvironment,
    CODEGRAPH_MCP_TOOLS: 'search',
  });
  const calls = Array.from({ length: 12 }, (_, index) =>
    getCodeGraphPreparationToolDefinition({
      executable,
      toolName: 'codegraph_search',
      toolVisibility: index < 6 ? '' : 'search',
    }),
  );
  const outcomes = await Promise.all(calls);
  expect(outcomes.slice(0, 6).every((value) => value === undefined)).toBe(true);
  expect(outcomes.slice(6).every((value) => value?.name === 'codegraph_search')).toBe(true);
  expect((await readFile(jobs, 'utf8')).split('\n').filter(Boolean)).toEqual(['search']); // Two jobs: default empty visibility and search.
  expect((await readFile(jobs, 'utf8')).split('\n')).toHaveLength(3);
  expect(
    await getCodeGraphPreparationToolDefinition({ executable, toolName: 'codegraph_explore', toolVisibility: '' }),
  ).toEqual(nativeDefinition);
  expect(
    await getCodeGraphPreparationToolDefinition({
      executable,
      toolName: 'codegraph_explore',
      toolVisibility: 'search',
    }),
  ).toBeUndefined();
  expect((await getCodeGraphPreparationToolDefinition({ executable, toolName: 'codegraph_search' }))?.name).toBe(
    'codegraph_search',
  );
  expect((await readFile(jobs, 'utf8')).split('\n')).toHaveLength(3); // Effective inherited search reuses its snapshot.
  expect(
    await getCodeGraphPreparationToolDefinition({
      executable,
      toolName: 'codegraph_search',
      toolVisibility: 'unknown_native_tool',
    }),
  ).toBeUndefined();
  expect((await readFile(jobs, 'utf8')).split('\n')).toHaveLength(4);
  expect(await readFile(source, 'utf8')).toBe('export const unchanged = 1;');
  await expect(access(path.join(fixture, '.codegraph'))).rejects.toThrow();
  await expect(access(path.join(fixture, 'lib', 'dist', '.codegraph'))).rejects.toThrow();
});

it('coalesces identical metadata, detaches cancellation and revalidates SDK/visibility without sharing mutable schemas', async () => {
  const gate = path.join(fixture, 'release');
  const started = path.join(fixture, 'started');
  await metadataBundle(blockedMetadata(gate, started));
  const controller = new AbortController();
  const requests = Array.from({ length: 12 }, (_, index) =>
    getCodeGraphPreparationToolDefinition(
      { executable, toolName: 'codegraph_explore' },
      { signal: index === 0 ? controller.signal : undefined, executionDeadlineMs: 5_000 },
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
  );
  try {
    await vi.waitFor(async () => expect(await existingPid(started)).toBeDefined());
    const pid = await existingPid(started);
    controller.abort();
    expect(await requests[0]).toMatchObject({ error: { code: 'cancelled' } });
    expect(() => process.kill(pid!, 0)).not.toThrow();
    await writeFile(gate, 'released');
    const results = await Promise.all(requests.slice(1));
    expect(results.every((result) => 'value' in result && result.value?.name === 'codegraph_explore')).toBe(true);
    const changed = 'value' in results[0] ? results[0].value : undefined;
    if (!changed) throw new Error('Missing native definition');
    changed.inputSchema.type = 'caller-corruption';
    expect(
      (await getCodeGraphPreparationToolDefinition({ executable, toolName: 'codegraph_explore' }))?.inputSchema.type,
    ).toBe('object');
    expect(await existingPid(started)).toBe(pid); // No second descriptor child.
    const tools = path.join(fixture, 'lib', 'dist', 'mcp', 'tools.js');
    const changedSchema = { ...nativeDefinition, inputSchema: { ...nativeDefinition.inputSchema, minProperties: 3 } };
    await writeFile(
      tools,
      `exports.tools=${JSON.stringify([changedSchema])};exports.getStaticTools=()=>process.env.CODEGRAPH_MCP_TOOLS==='hidden'?[]:exports.tools;`,
    );
    expect(
      (await getCodeGraphPreparationToolDefinition({ executable, toolName: 'codegraph_explore' }))?.inputSchema
        .minProperties,
    ).toBe(3);
    const nativeEnvironment = environment.codeGraphEnvironment();
    vi.spyOn(environment, 'codeGraphEnvironment').mockReturnValue({
      ...nativeEnvironment,
      CODEGRAPH_MCP_TOOLS: 'hidden',
    });
    expect(await getCodeGraphPreparationToolDefinition({ executable, toolName: 'codegraph_explore' })).toBeUndefined();
  } finally {
    await writeFile(gate, 'released');
    await Promise.allSettled(requests);
  }
});

it('shares the adapter native work gate across distinct metadata installations and skips a cancelled queued owner', async () => {
  let releaseNative!: () => void;
  const nativeBlocked = new Promise<void>((resolve) => {
    releaseNative = resolve;
  });
  const nativeWork = [
    runCodeGraphNativeWork(undefined, () => nativeBlocked),
    runCodeGraphNativeWork(undefined, () => nativeBlocked),
  ];
  const gate = path.join(fixture, 'release');
  const starts: string[] = [];
  const binaries: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const started = path.join(fixture, `started-${index}`);
    starts.push(started);
    binaries.push(await metadataBundle(blockedMetadata(gate, started), path.join(fixture, `bundle-${index}`)));
  }
  const controllers = binaries.map(() => new AbortController());
  const requests = binaries.map((binary, index) =>
    getCodeGraphPreparationToolDefinition(
      { executable: binary, toolName: 'codegraph_explore' },
      { signal: controllers[index].signal, executionDeadlineMs: 5_000 },
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
  );
  try {
    await vi.waitFor(async () => expect((await Promise.all(starts.map(existingPid))).filter(Boolean)).toHaveLength(2));
    const pids = await Promise.all(starts.map(existingPid));
    const queued = pids.findIndex((pid) => pid === undefined);
    controllers[queued].abort();
    expect(await requests[queued]).toMatchObject({ error: { code: 'cancelled' } });
    releaseNative();
    await vi.waitFor(async () => expect((await Promise.all(starts.map(existingPid))).filter(Boolean)).toHaveLength(4));
    await writeFile(gate, 'released');
    const outcomes = await Promise.all(requests);
    expect(outcomes.filter((outcome) => 'value' in outcome)).toHaveLength(11);
    expect(await existingPid(starts[queued])).toBeUndefined();
    for (const pid of (await Promise.all(starts.map(existingPid))).filter((pid): pid is number => pid !== undefined))
      expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    releaseNative();
    await writeFile(gate, 'released');
    await Promise.allSettled([...nativeWork, ...requests]);
  }
});

it('drains active and queued metadata children on shutdown and discards their schema snapshots', async () => {
  const gate = path.join(fixture, 'release');
  const starts: string[] = [];
  const binaries: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const started = path.join(fixture, `started-${index}`);
    starts.push(started);
    binaries.push(await metadataBundle(blockedMetadata(gate, started), path.join(fixture, `bundle-${index}`)));
  }
  const requests = binaries.map((binary) =>
    getCodeGraphPreparationToolDefinition(
      { executable: binary, toolName: 'codegraph_explore' },
      { executionDeadlineMs: 5_000 },
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
  );
  await vi.waitFor(async () => expect((await Promise.all(starts.map(existingPid))).filter(Boolean)).toHaveLength(4));
  await disposeCodeGraphPreparationToolMetadata();
  expect(
    (await Promise.all(requests)).every((outcome) => 'error' in outcome && outcome.error.code === 'cancelled'),
  ).toBe(true);
  const pids = (await Promise.all(starts.map(existingPid))).filter((pid): pid is number => pid !== undefined);
  expect(pids).toHaveLength(4);
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  await writeFile(gate, 'released');
  expect(
    (await getCodeGraphPreparationToolDefinition({ executable: binaries[0], toolName: 'codegraph_explore' }))?.name,
  ).toBe('codegraph_explore');
  expect(await existingPid(starts[0])).not.toBe(pids[0]);
});

it('returns native tool schemas and unknown names without loading index or ownership paths', async () => {
  const definition = {
    name: 'codegraph_explore',
    description: 'Native descriptor',
    inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2 } }, required: ['query'] },
    annotations: { readOnlyHint: true },
  };
  await metadataBundle(
    `exports.tools = ${JSON.stringify([definition, { ...definition, name: 'codegraph_search' }])}; exports.getStaticTools = () => exports.tools.slice(0, 1);`,
  );
  const source = path.join(fixture, 'source.ts');
  const ignore = path.join(fixture, '.gitignore');
  await writeFile(source, 'export const unchanged = 1;');
  await writeFile(ignore, 'user-owned\n');
  expect(await getCodeGraphPreparationToolDefinition({ executable, toolName: definition.name })).toEqual(definition);
  expect(await getCodeGraphPreparationToolDefinition({ executable, toolName: 'not_a_native_tool' })).toBeUndefined();
  expect(await getCodeGraphPreparationToolDefinition({ executable, toolName: 'codegraph_search' })).toBeUndefined();
  expect(await readFile(source, 'utf8')).toBe('export const unchanged = 1;');
  expect(await readFile(ignore, 'utf8')).toBe('user-owned\n');
  await expect(access(path.join(fixture, '.codegraph'))).rejects.toThrow();
  await expect(access(path.join(fixture, 'lib', 'dist', '.codegraph'))).rejects.toThrow();
  await writeFile(path.join(fixture, 'lib', 'package.json'), JSON.stringify({ version: '1.6.3' }));
  await expect(getCodeGraphPreparationToolDefinition({ executable, toolName: definition.name })).rejects.toThrow(
    'verified for 1.6.2',
  );
});

it('does not spawn metadata after caller cancellation', async () => {
  await metadataBundle('throw new Error("Cancelled metadata must not execute");');
  const controller = new AbortController();
  controller.abort();
  await expect(
    getCodeGraphPreparationToolDefinition({ executable, toolName: 'codegraph_explore' }, { signal: controller.signal }),
  ).rejects.toThrow();
});

it('bounds an unresponsive native metadata module and awaits its owned process exit', async () => {
  const pidPath = path.join(fixture, 'metadata.pid');
  await metadataBundle(
    `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); while (true) {}`,
  );
  await expect(
    getCodeGraphPreparationToolDefinition({ executable, toolName: 'codegraph_explore' }, { executionDeadlineMs: 500 }),
  ).rejects.toMatchObject({ code: 'deadline_exceeded' });
  const pid = Number(await readFile(pidPath, 'utf8'));
  expect(() => process.kill(pid, 0)).toThrow();
}, 5_000);

it('rechecks a repaired prerequisite and rejects a package upgraded at the same path', async () => {
  await expect(resolveCodeGraphInstallation(executable)).rejects.toThrow();
  await mkdir(path.join(fixture, 'bin'));
  await mkdir(path.join(fixture, 'lib', 'dist', 'mcp'), { recursive: true });
  await writeFile(executable, '#!/bin/sh\n');
  await writeFile(path.join(fixture, 'lib', 'package.json'), JSON.stringify({ version: '1.6.2' }));
  await writeFile(path.join(fixture, 'lib', 'dist', 'index.js'), '');
  await writeFile(path.join(fixture, 'lib', 'dist', 'mcp', 'writer-lock.js'), '');
  await symlink(process.execPath, path.join(fixture, process.platform === 'win32' ? 'node.exe' : 'node'));
  expect((await resolveCodeGraphInstallation(executable)).version).toBe('1.6.2');
  await writeFile(path.join(fixture, 'lib', 'package.json'), JSON.stringify({ version: '1.6.3' }));
  await expect(resolveCodeGraphInstallation(executable)).rejects.toThrow('verified for 1.6.2');
});
