import path from 'node:path';

import {
  getProductCollectionPolicy,
  initializeProductTelemetry,
  productCollectionEnabled,
} from '@src/config/productTelemetryBootstrap.js';
import { MCP_SERVER_VERSION } from '@src/constants.js';
import { getGlobalConfigDir } from '@src/constants/paths.js';

import { dispatchProductBatch } from './delivery.js';
import { InstallationStore } from './installationStore.js';
import { writeProductNotice } from './notice.js';
import { type CommandCompletion, ProductUsageProducer } from './producer.js';

let producer: ProductUsageProducer | undefined;
export { PRODUCT_NOTICE } from './notice.js';

export function localInstallationStore(background = false): InstallationStore {
  return new InstallationStore(path.join(getGlobalConfigDir(), 'product-telemetry'), {
    background,
    notice: writeProductNotice,
  });
}

export function beginProductCommand(name: 'inspect'): CommandCompletion {
  const noCollection: CommandCompletion = { finish: () => {} };
  if (!productCollectionEnabled()) return noCollection;
  try {
    return (
      initializeProductTelemetry(() => {
        const policy = getProductCollectionPolicy();
        producer ??= new ProductUsageProducer({
          store: localInstallationStore(true),
          now: Date.now,
          dispatch: dispatchProductBatch,
          dimensions: {
            version: MCP_SERVER_VERSION,
            os: platform(),
            arch: architecture(),
            node_major: Number(process.versions.node.split('.')[0]),
            ci: policy.ci,
          },
        });
        return producer.beginCommand(name);
      }) ?? noCollection
    );
  } catch {
    return noCollection;
  }
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
