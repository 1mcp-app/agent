import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import { createRequire } from 'node:module';

import type { PreparedDelivery } from './installationStore.js';

const COLLECTOR = 'https://ingest.1mcp.app/v1/summaries';
const MAX_ACTIVE = 2;
const active = new Map<Worker, () => void>();
// Native SEA needs only built-ins; older npm runtimes load installed proxy compatibility modules.
const SEND_ONCE = `
const { workerData, parentPort } = require('node:worker_threads');
(async () => {
const url = new URL(workerData.endpoint);
if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported');
let address = url;
let transport = require(url.protocol === 'https:' ? 'node:https' : 'node:http');
const options = { method: 'POST', headers: { 'content-type': 'application/json' } };
let agent;
if (workerData.proxyModules) {
  const { getProxyForUrl } = await import(workerData.proxyModules.environment);
  const proxy = getProxyForUrl(url.href);
  if (proxy) {
    const parsed = new URL(proxy);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported_proxy');
    if (url.protocol === 'https:') {
      const { HttpsProxyAgent } = await import(workerData.proxyModules.https);
      agent = new HttpsProxyAgent(parsed);
    } else {
      address = parsed;
      transport = require(parsed.protocol === 'https:' ? 'node:https' : 'node:http');
      options.path = url.href;
      options.headers.host = url.host;
      if (parsed.username || parsed.password) {
        const credentials = decodeURIComponent(parsed.username) + ':' + decodeURIComponent(parsed.password);
        options.headers['proxy-authorization'] = 'Basic ' + Buffer.from(credentials).toString('base64');
        parsed.username = '';
        parsed.password = '';
      }
    }
  }
  agent ??= new transport.Agent({ keepAlive: false });
} else {
  agent = new transport.Agent({ keepAlive: false, proxyEnv: process.env });
}
const request = transport.request(address, { ...options, agent });
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
})().catch(() => { parentPort.close(); process.exitCode = 1; });
`;

/** Connect without a payload or a durable claim. Preparation cannot retain the foreground process. */
export function prepareProductDelivery(endpoint: string = COLLECTOR): Promise<PreparedDelivery | undefined> {
  if (active.size >= MAX_ACTIVE) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    const nativeProxy = major >= 25 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21);
    let proxyModules: { environment: string; https: string } | undefined;
    if (!nativeProxy) {
      // Older supported npm runtimes lack Agent.proxyEnv; native SEA uses Node 24.5+.
      const resolver = createRequire(import.meta.url);
      proxyModules = {
        environment: pathToFileURL(resolver.resolve('proxy-from-env')).href,
        https: pathToFileURL(resolver.resolve('https-proxy-agent')).href,
      };
    }
    const worker = new Worker(SEND_ONCE, {
      eval: true,
      execArgv: [],
      // Proxy libraries and native HTTP diagnostics must never print credentials or payloads.
      env: { ...process.env, DEBUG: '', NODE_DEBUG: '', NODE_DEBUG_NATIVE: '' },
      workerData: { endpoint, proxyModules },
      name: 'product-usage-delivery',
    });
    let ready = false;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      ready = false;
      void worker.terminate().catch(() => {});
      resolve(undefined);
    };
    active.set(worker, cancel);
    const deadline = setTimeout(cancel, 10_000);
    deadline.unref();
    worker.on('error', cancel);
    worker.once('message', (message) => {
      if (message !== 'ready') return;
      if (cancelled) return;
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
  for (const cancel of active.values()) cancel();
}
