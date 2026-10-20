import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Independent anonymous sessions are independent interaction owners. */
export async function startCapacityClients(url, count) {
  assert(Number.isInteger(count) && count > 0);
  const clients = [];
  const close = async () => {
    const results = await Promise.allSettled(clients.map((client) => client.close()));
    const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Capacity clients did not close');
  };
  try {
    for (let index = 0; index < count; index++) {
      const client = new Client({ name: 'capacity-owner', version: '1.0.0' });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp')));
    }
    return { clients, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function runCapacityWorkers(clients, concurrency, operation) {
  assert(clients.length > 0 && concurrency % clients.length === 0);
  return Promise.all(
    Array.from({ length: concurrency }, (_, index) => operation(clients[index % clients.length], index)),
  );
}
