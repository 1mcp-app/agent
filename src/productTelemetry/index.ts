import path from 'node:path';

import {
  getProductCollectionPolicy,
  initializeProductTelemetry,
  productCollectionEnabled,
} from '@src/config/productTelemetryBootstrap.js';
import { MCP_SERVER_VERSION } from '@src/constants.js';
import { getGlobalConfigDir } from '@src/constants/paths.js';

import { abortProductDelivery, dispatchProductBatch, prepareProductDelivery } from './delivery.js';
import { InstallationStore } from './installationStore.js';
import { writeProductNotice } from './notice.js';
import {
  type CommandCompletion,
  type CommandName,
  type FeatureName,
  type OperationName,
  ProductUsageProducer,
} from './producer.js';

let producer: ProductUsageProducer | undefined;
export { PRODUCT_NOTICE } from './notice.js';

export function localInstallationStore(background = false): InstallationStore {
  return new InstallationStore(path.join(getGlobalConfigDir(), 'product-telemetry'), {
    background,
    notice: writeProductNotice,
  });
}

function collection(): ProductUsageProducer | undefined {
  if (!productCollectionEnabled()) return;
  try {
    return initializeProductTelemetry(() => {
      const policy = getProductCollectionPolicy();
      producer ??= new ProductUsageProducer({
        store: localInstallationStore(true),
        now: Date.now,
        dispatch: dispatchProductBatch,
        prepareDelivery: prepareProductDelivery,
        abortDelivery: abortProductDelivery,
        dimensions: {
          version: MCP_SERVER_VERSION,
          os: platform(),
          arch: architecture(),
          node_major: Number(process.versions.node.split('.')[0]),
          ci: policy.ci,
        },
      });
      return producer;
    });
  } catch {
    return;
  }
}

export function beginProductCommand(name: CommandName): CommandCompletion {
  return collection()?.beginCommand(name) ?? { finish: () => {} };
}

export function beginProductFeature(name: FeatureName): CommandCompletion {
  return collection()?.beginFeature(name) ?? { finish: () => {} };
}

export function recordProductFeature(name: FeatureName, outcome: 'success' | 'failure'): void {
  collection()?.recordFeature(name, outcome);
}

export function beginProductOperation(
  name: OperationName,
  transport: 'none' | 'stdio' | 'http' | 'sse',
  client: 'none' | 'claude' | 'codex' | 'cursor' | 'vscode' | 'other',
): CommandCompletion {
  return collection()?.beginOperation(name, transport, client) ?? { finish: () => {} };
}

export function recordProductOperation(
  name: OperationName,
  outcome: 'success' | 'failure',
  transport: 'none' | 'stdio' | 'http' | 'sse',
  client: 'none' | 'claude' | 'codex' | 'cursor' | 'vscode' | 'other',
): void {
  collection()?.recordOperation(name, outcome, transport, client);
}

export function observeProductRuntimeConfiguration(name: 'servers' | 'tools', count: number): void {
  producer?.observeRuntimeConfiguration(name, count);
}

/** Snapshot only: attaches finite buckets to the next genuine activity. */
export function observeProductConfiguration(name: 'servers' | 'tools', count: number): void {
  producer?.observeConfiguration(name, count);
}

/** One invocation owns readiness/failure/cancellation; shutdown creates no outcome. */
export function beginProductStartup(name: 'serve' | 'proxy' | 'runtime_start'): CommandCompletion {
  const runtime = collection();
  if (!runtime) return { finish: () => {} };
  runtime.startRuntime();
  const command = name === 'runtime_start' ? runtime.beginRuntimeStartup() : runtime.beginCommand(name);
  let finished = false;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const handlers = signals.map((signal) => {
    const handler = () => {
      completion.finish('failure');
      // Preserve the default signal action when no lifecycle owner installed a handler yet.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    process.prependOnceListener(signal, handler);
    return handler;
  });
  const completion: CommandCompletion = {
    finish(outcome) {
      if (finished) return;
      finished = true;
      signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
      command.finish(outcome);
    },
  };
  return completion;
}
function platform(): 'linux' | 'darwin' | 'win32' | 'freebsd' | 'other' {
  switch (process.platform) {
    case 'linux':
    case 'darwin':
    case 'win32':
    case 'freebsd':
      return process.platform;
    default:
      return 'other';
  }
}
function architecture(): 'x64' | 'arm64' | 'arm' | 'ia32' | 'other' {
  switch (process.arch) {
    case 'x64':
    case 'arm64':
    case 'arm':
    case 'ia32':
      return process.arch;
    default:
      return 'other';
  }
}
