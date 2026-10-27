import http from 'node:http';
import https from 'node:https';
import type { AddressInfo, Socket } from 'node:net';

import { expect, it } from 'vitest';

import { dispatchProductBatch } from './delivery.js';

it('caps stalled senders at two, terminates their sockets at the deadline, and leaves global agents untouched', async () => {
  const httpAgent = http.globalAgent;
  const httpsAgent = https.globalAgent;
  const sockets = new Set<Socket>();
  const bodies: string[] = [];
  let received!: () => void;
  const bothReceived = new Promise<void>((resolve) => {
    received = resolve;
  });
  let closed!: () => void;
  const bothClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  let closes = 0;
  const server = http.createServer((request) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      bodies.push(body);
      if (bodies.length === 2) received();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
      if (++closes === 2) closed();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const deadline = Date.now();
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    guard = setTimeout(() => reject(new Error('controlled sender failed to terminate')), 5000);
  });
  try {
    const endpoint = `http://127.0.0.1:${port}/synthetic`;
    dispatchProductBatch('first', endpoint);
    dispatchProductBatch('second', endpoint);
    dispatchProductBatch('capacity-drop', endpoint);
    await Promise.race([bothReceived, timeout]);
    expect(bodies.sort()).toEqual(['first', 'second']);
    await Promise.race([bothClosed, timeout]);
    expect(Date.now() - deadline).toBeGreaterThanOrEqual(1300);
    expect(Date.now() - deadline).toBeLessThan(5000);
    expect(bodies).toHaveLength(2);
    expect(http.globalAgent).toBe(httpAgent);
    expect(https.globalAgent).toBe(httpsAgent);
  } finally {
    clearTimeout(guard);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10000);
