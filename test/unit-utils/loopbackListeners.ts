import { once } from 'node:events';
import { createServer, type RequestListener, type Server } from 'node:http';

/** Own the IPv4 endpoints Supertest connects to, avoiding dual-stack port collisions. */
export function createLoopbackListeners() {
  const listeners = new Map<RequestListener, Server>();
  return {
    async listen(app: RequestListener): Promise<Server> {
      let listener = listeners.get(app);
      if (!listener) {
        listener = createServer(app);
        listeners.set(app, listener);
        listener.listen(0, '127.0.0.1');
      }
      if (!listener.listening) await once(listener, 'listening');
      return listener;
    },
    async close(): Promise<void> {
      try {
        await Promise.all(
          [...listeners.values()]
            .filter((listener) => listener.listening)
            .map(async (listener) => {
              listener.closeAllConnections();
              await new Promise<void>((resolve, reject) =>
                listener.close((error) => (error ? reject(error) : resolve())),
              );
            }),
        );
      } finally {
        listeners.clear();
      }
    },
  };
}
