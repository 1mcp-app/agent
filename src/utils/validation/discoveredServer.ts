import type { RuntimeTargetObservedIdentity } from '@src/domains/runtime-targets/runtimeTargetStore.js';

export type DiscoveredServer =
  | {
      url: string;
      source: 'pidfile';
      validated: true;
      pid: number;
      runtimeIdentity?: RuntimeTargetObservedIdentity;
    }
  | {
      url: string;
      source: 'user' | 'portscan';
      validated: false;
      pid?: never;
      runtimeIdentity?: never;
    };
