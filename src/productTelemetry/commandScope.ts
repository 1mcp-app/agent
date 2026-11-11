import { AsyncLocalStorage } from 'node:async_hooks';

import { beginProductCommand } from '@src/productTelemetry/index.js';
import type { CommandName } from '@src/productTelemetry/producer.js';

interface Completion {
  finish(outcome: 'success' | 'failure'): void;
}
const activeCommand = new AsyncLocalStorage<Completion>();

/** Called only inside validated, registered handlers; never from parser middleware. */
export async function runProductCommand<T>(name: CommandName, run: () => Promise<T>): Promise<T> {
  if (activeCommand.getStore()) return run();
  const product = beginProductCommand(name);
  let finished = false;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const handlers = signals.map((signal) => {
    const handler = () => {
      completion.finish('failure');
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    process.prependOnceListener(signal, handler);
    return handler;
  });
  const completion: Completion = {
    finish(outcome) {
      if (finished) return;
      finished = true;
      signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
      product.finish(outcome);
    },
  };
  return activeCommand.run(completion, async () => {
    try {
      const result = await run();
      completion.finish(process.exitCode && process.exitCode !== '0' ? 'failure' : 'success');
      return result;
    } catch (error) {
      completion.finish('failure');
      throw error;
    }
  });
}

/** The terminal owner supplies only its existing numeric status. */
export function finishProductCommand(code: number): void {
  activeCommand.getStore()?.finish(code === 0 ? 'success' : 'failure');
}

/** Preserve immediate terminal exit semantics, including existing cleanup behavior. */
export function exitProductCommand(code: number): never {
  finishProductCommand(code);
  process.exit(code);
}
