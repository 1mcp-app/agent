import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeGraphPreparationError, runCodeGraphNativeWork } from './codegraphProcess.js';
import { disposeCodeGraphPreparationToolMetadata, getCodeGraphPreparationToolDefinition } from './codegraphReadOnly.js';

const { worker } = vi.hoisted(() => ({ worker: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  realpath: vi.fn(async (file: string) => file),
  stat: vi.fn(async () => ({ dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n, ctimeNs: 5n })),
  readFile: vi.fn(async () => Buffer.from('verified native tool metadata')),
}));
vi.mock('./codegraphInstallation.js', () => ({
  VERIFIED_CODEGRAPH_VERSION: '1.6.2',
  resolveCodeGraphInstallation: vi.fn(async () => ({
    libraryRoot: '/verified/library',
    nodeExecutable: '/verified/node',
    version: '1.6.2',
  })),
}));
vi.mock('./codegraphProcess.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./codegraphProcess.js')>()),
  runCodeGraphWorker: worker,
}));

const definition = { name: 'codegraph_explore', inputSchema: { type: 'object' } };
const options = { executable: '/verified/codegraph', toolName: definition.name };
const pendingNative = new Set<{ reject: (error: unknown) => void }>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const result = { promise, resolve, reject };
  pendingNative.add(result);
  return result;
}

describe('owned native metadata cache lifecycle', () => {
  beforeEach(() => worker.mockReset());
  afterEach(async () => {
    for (const pending of pendingNative) pending.reject(new CodeGraphPreparationError('cancelled', 'Fixture closed.'));
    pendingNative.clear();
    await disposeCodeGraphPreparationToolMetadata();
  });

  it('lets a new caller replace an abandoned job before old exit, without old cleanup deleting the replacement', async () => {
    const closing = deferred<unknown>();
    worker.mockReturnValueOnce(closing.promise).mockResolvedValue({ tools: [definition] });
    const controller = new AbortController();
    let firstFinished = false;
    const first = getCodeGraphPreparationToolDefinition(options, { signal: controller.signal }).catch((error) => {
      firstFinished = true;
      return error;
    });
    await vi.waitFor(() => expect(worker).toHaveBeenCalledOnce());
    const ownedSignal = worker.mock.calls[0][3].signal as AbortSignal;
    controller.abort();
    await vi.waitFor(() => expect(ownedSignal.aborted).toBe(true));
    expect(firstFinished).toBe(false);

    await expect(getCodeGraphPreparationToolDefinition(options)).resolves.toEqual(definition);
    expect(worker).toHaveBeenCalledTimes(2);
    expect(worker.mock.calls[1][3].signal.aborted).toBe(false);
    closing.reject(new CodeGraphPreparationError('cancelled', 'Owned worker closed.'));
    await expect(first).resolves.toMatchObject({ code: 'cancelled' });
    await expect(getCodeGraphPreparationToolDefinition(options)).resolves.toEqual(definition);
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it('drains both a retired worker and its replacement on shutdown until each owned exit is verified', async () => {
    const retired = deferred<unknown>();
    const replacement = deferred<unknown>();
    worker.mockReturnValueOnce(retired.promise).mockReturnValueOnce(replacement.promise);
    const controller = new AbortController();
    const first = getCodeGraphPreparationToolDefinition(options, { signal: controller.signal }).catch((error) => error);
    await vi.waitFor(() => expect(worker).toHaveBeenCalledOnce());
    controller.abort();
    await vi.waitFor(() => expect(worker.mock.calls[0][3].signal.aborted).toBe(true));
    const second = getCodeGraphPreparationToolDefinition(options).catch((error) => error);
    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(2));

    let shutdownFinished = false;
    const shutdown = disposeCodeGraphPreparationToolMetadata().then(() => {
      shutdownFinished = true;
    });
    expect(worker.mock.calls[1][3].signal.aborted).toBe(true);
    replacement.reject(new CodeGraphPreparationError('cancelled', 'Replacement closed.'));
    await second;
    expect(shutdownFinished).toBe(false);
    retired.reject(new CodeGraphPreparationError('cancelled', 'Retired worker closed.'));
    await first;
    await shutdown;
    expect(shutdownFinished).toBe(true);
  });

  it('keeps a shared job alive when one waiter cancels and another still needs the metadata', async () => {
    const native = deferred<unknown>();
    worker.mockReturnValue(native.promise);
    const controller = new AbortController();
    const first = getCodeGraphPreparationToolDefinition(options, { signal: controller.signal }).catch((error) => error);
    await vi.waitFor(() => expect(worker).toHaveBeenCalledOnce());
    const second = getCodeGraphPreparationToolDefinition(options);
    // A cached installation/identity lookup still resolves asynchronously.
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(first).resolves.toMatchObject({ code: 'cancelled' });
    expect(worker.mock.calls[0][3].signal.aborted).toBe(false);
    native.resolve({ tools: [definition] });
    await expect(second).resolves.toEqual(definition);
    expect(worker).toHaveBeenCalledOnce();
  });

  it('keeps a retiring worker in the shared native capacity gate until verified exit', async () => {
    const closing = deferred<unknown>();
    worker.mockReturnValueOnce(closing.promise).mockResolvedValue({ tools: [definition] });
    const controller = new AbortController();
    const first = getCodeGraphPreparationToolDefinition(options, { signal: controller.signal }).catch((error) => error);
    await vi.waitFor(() => expect(worker).toHaveBeenCalledOnce());
    const held = deferred<void>();
    let occupied = 0;
    const otherNativeJobs = Array.from({ length: 3 }, () =>
      runCodeGraphNativeWork(new AbortController().signal, async () => {
        occupied += 1;
        await held.promise;
      }).catch((error) => error),
    );
    await vi.waitFor(() => expect(occupied).toBe(3));
    controller.abort();
    await vi.waitFor(() => expect(worker.mock.calls[0][3].signal.aborted).toBe(true));
    const replacement = getCodeGraphPreparationToolDefinition(options);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(worker).toHaveBeenCalledOnce();

    closing.reject(new CodeGraphPreparationError('cancelled', 'Retired worker closed.'));
    await expect(first).resolves.toMatchObject({ code: 'cancelled' });
    await expect(replacement).resolves.toEqual(definition);
    expect(worker).toHaveBeenCalledTimes(2);
    held.resolve();
    await Promise.all(otherNativeJobs);
  });
});

it('resolves the acceptance launcher from its own escaped module URL independently of the working directory', async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const script = await fs.readFile(
    new URL('../../../scripts/verify-codegraph-preparation.mjs', import.meta.url),
    'utf8',
  );
  const expression = script.match(/async function readOnlySession\(root\) \{\s*const entry = ([^;]+);/)?.[1];
  expect(expression).toBeDefined();
  const scriptPath = path.join('/foreign/repo #percent% space', 'scripts', 'verify-codegraph-preparation.mjs');
  const resolveEntry = new Function('scriptUrl', `return (${expression!.replace('import.meta.url', 'scriptUrl')});`);
  const entry = resolveEntry(pathToFileURL(scriptPath).href);
  expect(fileURLToPath(entry)).toBe(
    '/foreign/repo #percent% space/build/domains/backend-preparation/codegraphReadOnly.js',
  );
});
