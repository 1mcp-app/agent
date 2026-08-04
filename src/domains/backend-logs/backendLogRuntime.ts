import { BackendLogBroker } from './backendLogBroker.js';

let runtimeBroker = new BackendLogBroker();

export function getBackendLogBroker(): BackendLogBroker {
  return runtimeBroker;
}

export function resetBackendLogBroker(): BackendLogBroker {
  runtimeBroker.clear();
  runtimeBroker = new BackendLogBroker();
  return runtimeBroker;
}
