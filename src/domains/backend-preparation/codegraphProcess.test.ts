import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCodeGraphWorker } from './codegraphProcess.js';

describe('owned CodeGraph worker lifecycle', () => {
  let fixture: string;
  let root: string;
  let libraryRoot: string;

  beforeEach(async () => {
    fixture = await mkdtemp(path.join(os.tmpdir(), 'codegraph-worker-unit-'));
    root = path.join(fixture, 'checkout');
    libraryRoot = path.join(fixture, 'library');
    await mkdir(root);
    await mkdir(path.join(libraryRoot, 'mcp'), { recursive: true });
    await mkdir(path.join(libraryRoot, 'extraction'));
    await writeFile(path.join(libraryRoot, '..', 'package.json'), JSON.stringify({ version: '1.6.2' }));
    await writeFile(
      path.join(libraryRoot, 'utils.js'),
      'exports.FileLock = class { constructor(p){this.lockPath=p;this.held=false;} };',
    );
    await writeFile(path.join(libraryRoot, 'directory.js'), 'exports.unsafeIndexRootReason = () => null;');
    await writeFile(path.join(libraryRoot, 'extraction/extraction-version.js'), 'exports.EXTRACTION_VERSION = 1;');
    await writeFile(
      path.join(libraryRoot, 'mcp/writer-lock.js'),
      `
      const fs=require('node:fs'),path=require('node:path');
      exports.getWriterPidPath=(root,name)=>path.join(root,'.codegraph',name);
      exports.releaseWriterLock=(root,name)=>{const p=exports.getWriterPidPath(root,name);try{if(JSON.parse(fs.readFileSync(p,'utf8')).pid===process.pid)fs.unlinkSync(p)}catch{}};
    `,
    );
  });

  afterEach(async () => {
    await rm(fixture, { recursive: true, force: true });
  });

  async function sdk(cooperative: boolean) {
    await writeFile(
      path.join(libraryRoot, 'index.js'),
      `
      const fs=require('node:fs'),path=require('node:path');
      exports.getCodeGraphDir=root=>path.join(root,'.codegraph');
      exports.getDatabasePath=root=>path.join(root,'.codegraph','codegraph.db');
      exports.CodeGraph={init:async(root)=>({
        indexAll:async({signal})=>{fs.writeFileSync(path.join(root,'.codegraph','codegraph.lock'),String(process.pid));fs.writeFileSync(path.join(root,'started'),String(process.pid));await new Promise((resolve,reject)=>{${cooperative ? 'signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});' : ''}setInterval(()=>{},1000);});},
        destroy:()=>{fs.unlinkSync(path.join(root,'.codegraph','codegraph.lock'));}
      })};
    `,
    );
  }

  const installation = () => ({ nodeExecutable: process.execPath, libraryRoot, version: '1.6.2' });

  async function startedPid(): Promise<number> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        return Number(await readFile(path.join(root, 'started'), 'utf8'));
      } catch {
        /* The worker may still be starting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Worker did not start.');
  }

  it('preserves a malformed native DB lock inserted after writer ownership is acquired', async () => {
    await writeFile(
      path.join(libraryRoot, 'index.js'),
      `
      const fs=require('node:fs'),path=require('node:path'),{FileLock}=require('./utils.js');
      exports.getCodeGraphDir=root=>path.join(root,'.codegraph');
      exports.getDatabasePath=root=>path.join(root,'.codegraph','codegraph.db');
      exports.CodeGraph={init:async(root)=>({
        indexAll:async()=>{const p=path.join(root,'.codegraph','codegraph.lock');fs.writeFileSync(p,'foreign malformed owner',{flag:'wx'});new FileLock(p).acquire();},
        destroy:()=>{}
      })};
    `,
    );
    await expect(
      runCodeGraphWorker(installation(), root, 'initialize', { executionDeadlineMs: 5_000 }),
    ).rejects.toMatchObject({ code: 'ownership_conflict' });
    expect(await readFile(path.join(root, '.codegraph', 'codegraph.lock'), 'utf8')).toBe('foreign malformed owner');
    await expect(access(path.join(root, '.codegraph', 'writer.pid'))).rejects.toThrow();
  });

  it('cooperatively cancels only its child and waits for verified exit', async () => {
    await sdk(true);
    const controller = new AbortController();
    const job = runCodeGraphWorker(installation(), root, 'initialize', {
      signal: controller.signal,
      executionDeadlineMs: 5_000,
      terminationGraceMs: 100,
    });
    const pid = await startedPid();
    controller.abort();
    await expect(job).rejects.toMatchObject({ code: 'cancelled' });
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(access(path.join(root, '.codegraph', 'writer.pid'))).rejects.toThrow();
    await expect(access(path.join(root, '.codegraph', 'rebuild.pid'))).rejects.toThrow();
  });

  it('enforces a deadline, preserves uncertain forced-exit locks and allows a foreign takeover without deleting it', async () => {
    await sdk(false);
    const job = runCodeGraphWorker(installation(), root, 'initialize', {
      executionDeadlineMs: 500,
      terminationGraceMs: 30,
    });
    const pid = await startedPid();
    await expect(job).rejects.toMatchObject({ code: 'deadline_exceeded' });
    expect(() => process.kill(pid, 0)).toThrow();
    expect(JSON.parse(await readFile(path.join(root, '.codegraph', 'writer.pid'), 'utf8')).pid).toBe(pid);
    expect((await readFile(path.join(root, '.codegraph', 'codegraph.lock'), 'utf8')).trim()).toBe(String(pid));
    const foreign = JSON.stringify({ pid: process.pid, mode: 'foreign-takeover', claimId: 'foreign' });
    await rm(path.join(root, '.codegraph', 'writer.pid'));
    await writeFile(path.join(root, '.codegraph', 'writer.pid'), foreign, { flag: 'wx' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await readFile(path.join(root, '.codegraph', 'writer.pid'), 'utf8')).toBe(foreign);
  });

  it('leaves a live foreign owner and its lock untouched', async () => {
    await sdk(false);
    await mkdir(path.join(root, '.codegraph'));
    const owner = JSON.stringify({ pid: process.pid, mode: 'foreign', startedAt: Date.now(), ready: false });
    await writeFile(path.join(root, '.codegraph', 'writer.pid'), owner);
    await expect(
      runCodeGraphWorker(installation(), root, 'initialize', { executionDeadlineMs: 1_000 }),
    ).rejects.toMatchObject({ code: 'ownership_conflict' });
    expect(await readFile(path.join(root, '.codegraph', 'writer.pid'), 'utf8')).toBe(owner);
    expect(() => process.kill(process.pid, 0)).not.toThrow();
    await expect(access(path.join(root, 'started'))).rejects.toThrow();
  });

  async function metadataSdk(state: string, malformed = false) {
    await mkdir(path.join(root, '.codegraph'));
    await writeFile(path.join(root, '.codegraph', 'codegraph.db'), 'native-db-fixture');
    await writeFile(path.join(root, 'probe.ts'), 'export function ReadOnlyMetadataFixture() { return 42; }\n');
    await writeFile(path.join(root, '.gitignore'), '# Existing user preference\n');
    await writeFile(
      path.join(libraryRoot, 'index.js'),
      `
      const path=require('node:path');
      exports.getCodeGraphDir=root=>path.join(root,'.codegraph');
      exports.getDatabasePath=root=>path.join(root,'.codegraph','codegraph.db');
      exports.DatabaseConnection={open:(_file,options)=>{
        if(options?.readOnly!==true)throw new Error('Writable storage open forbidden');
        ${malformed ? "throw new Error('Malformed native database');" : 'return {getDb:()=>({}),close:()=>{}};'}
      }};
      exports.QueryBuilder=class{};
      exports.CodeGraph=class{
        static open(){throw new Error('Facade repair forbidden');}
        static init(){throw new Error('Initialization forbidden');}
        getIndexBuildInfo(){return {version:'1.6.2',extractionVersion:1};}
        isIndexStale(){return false;}
        getIndexState(){return ${JSON.stringify(state)};}
        getPendingReferenceCount(){return 0;}
        getChangedFiles(){throw new Error('Source scan forbidden');}
        getStats(){throw new Error('Full readiness snapshot forbidden');}
        destroy(){}
      };
    `,
    );
  }

  it.each(['partial', 'complete'])(
    'reads only native index metadata for %s state without scanner, repairs or writer locks',
    async (state) => {
      await metadataSdk(state);
      const paths = ['.codegraph/codegraph.db', 'probe.ts', '.gitignore'];
      const before = await Promise.all(paths.map((file) => readFile(path.join(root, file), 'utf8')));
      const result = await runCodeGraphWorker(installation(), root, 'inspect-index', { executionDeadlineMs: 5_000 });
      expect(result).toEqual({
        initialized: true,
        projectPath: root,
        indexPath: path.join(root, '.codegraph'),
        index: {
          builtWithVersion: '1.6.2',
          builtWithExtractionVersion: 1,
          currentExtractionVersion: 1,
          reindexRecommended: false,
          state,
          pendingRefs: 0,
        },
      });
      expect(await Promise.all(paths.map((file) => readFile(path.join(root, file), 'utf8')))).toEqual(before);
      expect(await readdir(path.join(root, '.codegraph'))).toEqual(['codegraph.db']);
    },
  );

  it('reports malformed index storage without repairing it or scanning source', async () => {
    await metadataSdk('partial', true);
    await expect(
      runCodeGraphWorker(installation(), root, 'inspect-index', { executionDeadlineMs: 5_000 }),
    ).rejects.toMatchObject({ code: 'backend_failed', message: 'Malformed native database' });
    expect(await readFile(path.join(root, '.codegraph', 'codegraph.db'), 'utf8')).toBe('native-db-fixture');
    expect(await readdir(path.join(root, '.codegraph'))).toEqual(['codegraph.db']);
  });

  it('preserves a live foreign owner during read-only index metadata inspection', async () => {
    await metadataSdk('partial');
    const owner = JSON.stringify({ pid: process.pid, mode: 'foreign', ready: false });
    await writeFile(path.join(root, '.codegraph', 'writer.pid'), owner);
    await expect(
      runCodeGraphWorker(installation(), root, 'inspect-index', { executionDeadlineMs: 5_000 }),
    ).rejects.toMatchObject({ code: 'ownership_conflict' });
    expect(await readFile(path.join(root, '.codegraph', 'writer.pid'), 'utf8')).toBe(owner);
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });

  it.each(['inspect', 'inspect-index', 'describe-tools'])(
    'reports an owned read-only %s deadline without suggesting writer lock repair',
    async (action) => {
      const hanging = `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'started'))},String(process.pid));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);`;
      await writeFile(path.join(libraryRoot, 'index.js'), hanging);
      await writeFile(path.join(libraryRoot, 'mcp/tools.js'), hanging);
      const job = runCodeGraphWorker(installation(), root, action, {
        executionDeadlineMs: 500,
        terminationGraceMs: 30,
      });
      const pid = await startedPid();
      await expect(job).rejects.toMatchObject({
        code: 'deadline_exceeded',
        message:
          'CodeGraph read-only inspection exceeded its inspection budget; no preparation or writer-lock acquisition was started.',
      });
      expect(() => process.kill(pid, 0)).toThrow();
      await expect(access(path.join(root, '.codegraph'))).rejects.toThrow();
    },
  );

  it.each(['inspect', 'inspect-index', 'describe-tools'])(
    'reports an already-cancelled read-only %s without preparation or lock claims',
    async (action) => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        runCodeGraphWorker(installation(), root, action, { signal: controller.signal, executionDeadlineMs: 5_000 }),
      ).rejects.toMatchObject({
        code: 'cancelled',
        message: 'CodeGraph read-only inspection cancelled; no preparation or writer-lock acquisition was started.',
      });
      await expect(access(path.join(root, '.codegraph'))).rejects.toThrow();
      await expect(access(path.join(root, 'started'))).rejects.toThrow();
    },
  );
});
