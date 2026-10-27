import { Worker } from 'node:worker_threads';

const COLLECTOR = 'https://ingest.1mcp.app/v1/summaries';
const MAX_ACTIVE = 2;
const active = new Set<Worker>();
// Fixed built-in-only source also works when the caller is a bundled SEA executable.
const SEND_ONCE = `
const { workerData } = require('node:worker_threads');
const url = new URL(workerData.endpoint);
if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported');
const transport = require(url.protocol === 'https:' ? 'node:https' : 'node:http');
const request = transport.request(url, {
  method: 'POST', agent: false,
  headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(workerData.body) },
});
request.on('error', () => request.destroy());
request.on('response', response => {
  response.resume();
  response.on('end', () => request.destroy());
  response.on('error', () => request.destroy());
});
request.end(workerData.body);
`;

/** Final one-shot attempt. Even a stalled OS DNS request cannot retain the foreground process. */
export function dispatchProductBatch(body: string, endpoint: string = COLLECTOR): void {
  if (active.size >= MAX_ACTIVE) return;
  const worker = new Worker(SEND_ONCE, {
    eval: true,
    execArgv: [],
    workerData: { body, endpoint },
    name: 'product-usage-delivery',
  });
  active.add(worker);
  const deadline = setTimeout(() => {
    void worker.terminate().catch(() => {});
  }, 1500);
  deadline.unref();
  worker.on('error', () => {});
  worker.once('exit', () => {
    active.delete(worker);
    clearTimeout(deadline);
  });
  worker.unref();
}

/** Best effort: bytes already transmitted cannot be recalled. */
export function abortProductDelivery(): void {
  for (const worker of active) void worker.terminate().catch(() => {});
}
