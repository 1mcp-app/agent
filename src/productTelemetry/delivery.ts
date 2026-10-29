import { Worker } from 'node:worker_threads';

import type { PreparedDelivery } from './installationStore.js';

const COLLECTOR = 'https://ingest.1mcp.app/v1/summaries';
const MAX_ACTIVE = 2;
const active = new Set<Worker>();
// Fixed built-in-only source also works when the caller is a bundled SEA executable.
const SEND_ONCE = `
const { workerData, parentPort } = require('node:worker_threads');
const url = new URL(workerData.endpoint);
if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported');
const transport = require(url.protocol === 'https:' ? 'node:https' : 'node:http');
const agent = new transport.Agent({ keepAlive: false, proxyEnv: process.env });
const request = transport.request(url, {
  method: 'POST', agent,
  headers: { 'content-type': 'application/json' },
});
const close = () => { request.destroy(); agent.destroy(); parentPort.close(); };
request.on('error', close);
request.on('response', response => {
  response.resume();
  response.on('end', close);
  response.on('error', close);
});
request.on('socket', socket => {
  const ready = () => parentPort.postMessage('ready');
  if (socket.encrypted && socket.secureConnecting) socket.once('secureConnect', ready);
  else if (socket.connecting) socket.once('connect', ready);
  else ready();
});
parentPort.once('message', body => {
  request.setHeader('content-length', Buffer.byteLength(body));
  request.end(body);
});
`;

/** Connect without a payload or a durable claim. Preparation cannot retain the foreground process. */
export function prepareProductDelivery(endpoint: string = COLLECTOR): Promise<PreparedDelivery | undefined> {
  if (active.size >= MAX_ACTIVE) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const worker = new Worker(SEND_ONCE, {
      eval: true,
      execArgv: [],
      workerData: { endpoint },
      name: 'product-usage-delivery',
    });
    active.add(worker);
    let ready = false;
    const cancel = () => {
      ready = false;
      void worker.terminate().catch(() => {});
      resolve(undefined);
    };
    const deadline = setTimeout(cancel, 10_000);
    deadline.unref();
    worker.on('error', cancel);
    worker.once('message', (message) => {
      if (message !== 'ready') return;
      ready = true;
      resolve({
        isReady: () => ready,
        cancel,
        dispatch: (body) => {
          if (!ready) return;
          ready = false;
          worker.postMessage(body);
        },
      });
    });
    worker.once('exit', () => {
      ready = false;
      active.delete(worker);
      clearTimeout(deadline);
      resolve(undefined);
    });
    worker.unref();
  });
}

/** Adapter for explicit serialized fixtures; live producers prepare before their final durable claim. */
export function dispatchProductBatch(body: string, endpoint: string = COLLECTOR): void {
  void prepareProductDelivery(endpoint)
    .then((delivery) => delivery?.dispatch(body))
    .catch(() => {});
}

/** Best effort: bytes already transmitted cannot be recalled. */
export function abortProductDelivery(): void {
  for (const worker of active) void worker.terminate().catch(() => {});
}
