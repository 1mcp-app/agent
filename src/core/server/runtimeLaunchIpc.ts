import { type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { runtimeReplacementSnapshotSchema } from './runtimeReplacementConfig.js';

export const launchBootstrapSchema = z
  .object({
    type: z.literal('runtime-bootstrap'),
    nonce: z.string().uuid(),
    claimId: z.string().uuid().optional(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    snapshot: runtimeReplacementSnapshotSchema,
    options: z.record(z.string(), z.unknown()),
  })
  .strict();
export type RuntimeLaunchBootstrap = z.infer<typeof launchBootstrapSchema>;

/** The IPC descriptor belongs to the child we spawned, never a PID discovered on disk. */
export function sendChild(child: ChildProcess, message: unknown): void {
  if (!child.connected) throw new Error('Runtime private launch channel disconnected');
  child.send(message as object, (error) => {
    if (error) child.emit('runtime-ipc-error', error);
  });
}

/** Losing a coordinator must not crash a healthy supervisor or worker through an unhandled IPC error. */
export function sendRuntimeParent(message: object): void {
  if (!process.connected || !process.send) return;
  try {
    process.send(message, () => {});
  } catch {
    /* The disconnect handler owns lifecycle policy. */
  }
}

export function receiveRuntimeBootstrap(): Promise<RuntimeLaunchBootstrap> {
  if (!process.send) throw new Error('Cooperative bootstrap requires a private parent channel');
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, value?: RuntimeLaunchBootstrap) => {
      clearTimeout(timer);
      process.off('message', receive);
      process.off('disconnect', disconnect);
      if (error) reject(error);
      else resolve(value!);
    };
    const receive = (message: unknown) => {
      const parsed = launchBootstrapSchema.safeParse(message);
      if (!parsed.success) {
        finish(new Error('Invalid private runtime bootstrap'));
        return;
      }
      finish(undefined, parsed.data);
    };
    const disconnect = () => finish(new Error('Launcher disconnected before authorization'));
    const timer = setTimeout(() => finish(new Error('Runtime bootstrap timed out')), 30_000);
    process.on('message', receive);
    process.once('disconnect', disconnect);
    sendRuntimeParent({ type: 'runtime-hello' });
  });
}

export function waitForChildActivation(child: ChildProcess, bootstrap: RuntimeLaunchBootstrap): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, message?: unknown) => {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', exit);
      child.off('error', fail);
      child.off('runtime-ipc-error', fail);
      if (error) reject(error);
      else resolve(message);
    };
    const fail = (error: Error) => finish(error);
    const exit = () => finish(new Error('Runtime child exited before activation'));
    let sent = false;
    const receive = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      if (message.type === 'runtime-hello' && !sent) {
        sent = true;
        sendChild(child, bootstrap);
        return;
      }
      if (message.type === 'runtime-failed') {
        finish(new Error('Runtime activation failed; inspect serve --status and the runtime log'));
        return;
      }
      if (message.type === 'runtime-activated') {
        if (child.exitCode !== null || child.signalCode !== null) {
          exit();
          return;
        }
        finish(undefined, message);
      }
    };
    const timer = setTimeout(
      () => finish(new Error('Runtime activation timed out; inspect status before recovery')),
      60_000,
    );
    child.on('message', receive);
    child.once('exit', exit);
    child.once('error', fail);
    child.once('runtime-ipc-error', fail);
  });
}

const replySchema = z.object({
  type: z.literal('runtime-reply'),
  id: z.string().uuid(),
  value: z.unknown(),
  error: z.string().optional(),
});
export function requestWorker(child: ChildProcess, action: 'close' | 'resume' | 'commit'): Promise<unknown> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, value?: unknown) => {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', exit);
      if (error) reject(error);
      else resolve(value);
    };
    const receive = (message: unknown) => {
      const parsed = replySchema.safeParse(message);
      if (!parsed.success || parsed.data.id !== id) return;
      finish(parsed.data.error ? new Error(parsed.data.error) : undefined, parsed.data.value);
    };
    const exit = () => finish(new Error('Runtime worker exited during control operation'));
    const timer = setTimeout(() => finish(new Error('Runtime worker control timed out; ownership retained')), 4000);
    child.on('message', receive);
    child.once('exit', exit);
    try {
      sendChild(child, { type: 'runtime-request', id, action });
    } catch (error) {
      finish(error as Error);
    }
  });
}
