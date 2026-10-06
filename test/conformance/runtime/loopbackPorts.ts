import { createServer } from 'node:net';

// Keep released ports out of subsequent allocations in this harness process.
// A child may still be starting when another concurrent task requests a port.
const issuedPorts = new Set<number>();

export async function reserveLoopbackPort(): Promise<number> {
  for (let candidate = 0; candidate < 32; candidate++) {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    let port: number | undefined;
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('port-reservation-failed');
      if (!issuedPorts.has(address.port)) {
        issuedPorts.add(address.port);
        port = address.port;
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    if (port !== undefined) return port;
  }
  throw new Error('port-reservation-exhausted');
}
