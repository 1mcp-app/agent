/** Synthetic producer worker. No CLI bootstrap, live installation root or collector. */
import fs from 'node:fs';
import path from 'node:path';

import { syncBuiltinESMExports } from 'node:module';

import type { Summary } from '../../src/productTelemetry/contract.js';
import { InstallationStore } from '../../src/productTelemetry/installationStore.js';

const root = process.argv[2];
const phase = process.argv[3];
const originalOpen = fs.promises.open;
const originalRename = fs.promises.rename;
const originalMkdir = fs.promises.mkdir;
async function checkpoint(stage: string) {
  if (phase !== stage) return;
  process.send?.({ checkpoint: stage });
  await new Promise(() => {});
}
// Fault injection belongs to the owned test process, never to the production store API.
fs.promises.open = async (...args: Parameters<typeof originalOpen>) => {
  const handle = await originalOpen(...args);
  if (String(args[0]).endsWith('.tmp')) {
    if (phase === 'write-failure')
      handle.writeFile = async () => {
        throw new Error('injected write failure');
      };
    await checkpoint('before-write');
    const originalSync = handle.sync.bind(handle);
    handle.sync = async () => {
      await originalSync();
      await checkpoint('after-write');
    };
  }
  return handle;
};
fs.promises.rename = async (...args: Parameters<typeof originalRename>) => {
  if (phase === 'rename-failure') throw new Error('injected commit failure');
  await checkpoint('before-rename');
  await originalRename(...args);
  await checkpoint('after-rename');
};
fs.promises.mkdir = (async (...args: Parameters<typeof originalMkdir>) => {
  const result = await originalMkdir(...args);
  if (String(args[0]) === path.join(root, 'lock')) await checkpoint('before-owner');
  if (String(args[0]) === path.join(root, 'guard')) await checkpoint('guard-created');
  return result;
}) as typeof originalMkdir;
syncBuiltinESMExports();
const store = new InstallationStore(root, {
  notice: async () => {
    await checkpoint('notice');
    process.send?.({ notice: true });
  },
  now: () => Date.parse('2026-10-27T10:12:34Z'),
});
process.on(
  'message',
  async (message: {
    id: number;
    action: string;
    ticket?: Parameters<typeof store.append>[0];
    facts?: Omit<Summary, 'installation_id'>;
  }) => {
    try {
      let result: unknown;
      switch (message.action) {
        case 'admit':
          result = await store.admit();
          break;
        case 'append':
          result = await store.append(message.ticket!, message.facts!);
          break;
        case 'send':
          await store.attemptSend(message.ticket!, (body) => {
            process.send?.({ body });
          });
          break;
        case 'reset':
          await store.control('reset');
          break;
        case 'disable':
          await store.control('disable');
          break;
        case 'enable':
          await store.control('enable');
          break;
        case 'status':
          result = await store.status();
          break;
      }
      process.send?.({ id: message.id, result });
    } catch {
      process.send?.({ id: message.id, error: true });
    }
  },
);
process.send?.({ ready: true });
