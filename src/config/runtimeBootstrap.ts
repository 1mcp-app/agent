import path from 'node:path';

import type { ApplicationConfig } from '@src/core/types/transport.js';

export interface FrozenRuntimeBootstrap {
  configFilePath: string;
  mcpConfig: Record<string, unknown>;
  appConfig: ApplicationConfig;
  runtimeEnvironment: Record<string, string>;
  parentEnvironment: Record<string, string>;
}

let bootstrap: FrozenRuntimeBootstrap | undefined;
let parentEnvironment: Record<string, string> | undefined;
let activationCallbacks: Array<() => void> = [];

export function installFrozenRuntimeBootstrap(input: FrozenRuntimeBootstrap): void {
  if (bootstrap) throw new Error('Runtime replacement bootstrap is already installed');
  bootstrap = structuredClone(input);
  parentEnvironment = { ...input.parentEnvironment };
}

export function getFrozenRuntimeBootstrap(configFilePath?: string): FrozenRuntimeBootstrap | undefined {
  if (!bootstrap) return undefined;
  if (configFilePath && path.resolve(configFilePath) !== bootstrap.configFilePath) return undefined;
  return structuredClone(bootstrap);
}

/** Environment plumbing, not application option access. */
export function getRuntimeParentEnvironment(): Record<string, string | undefined> {
  return parentEnvironment ? { ...parentEnvironment } : process.env;
}

export function deferUntilRuntimeActivation(callback: () => void): boolean {
  if (!bootstrap) return false;
  activationCallbacks.push(callback);
  return true;
}

export function releaseFrozenRuntimeBootstrap(): void {
  bootstrap = undefined;
  const callbacks = activationCallbacks;
  activationCallbacks = [];
  for (const callback of callbacks) callback();
}
