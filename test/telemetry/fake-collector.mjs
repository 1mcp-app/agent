import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { gunzipSync } from 'node:zlib';

/** Loopback-only OTLP boundary. Responses deliberately contain no SDK mocks. */
export async function createCollector({
  maxRequests = 4096,
  maxBodyBytes = 8 * 1024 * 1024,
  maxTotalBytes = 32 * 1024 * 1024,
  tls,
} = {}) {
  const requests = [];
  let response = { status: 200, delayMs: 0 };
  let discarded = 0;
  let capturedBytes = 0;
  const timers = new Set();
  const handler = async (req, res) => {
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBodyBytes) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const wire = Buffer.concat(chunks);
      const body =
        req.headers['content-encoding'] === 'gzip' ? gunzipSync(wire, { maxOutputLength: maxBodyBytes }) : wire;
      if (requests.length < maxRequests && capturedBytes + body.length <= maxTotalBytes) {
        capturedBytes += body.length;
        // Never capture secret HTTP headers in test artifacts.
        requests.push({ path: req.url, contentType: req.headers['content-type'], body });
      } else {
        discarded++;
      }
      const selected = { ...response };
      if (selected.forwardTo && selected.status === 200) {
        const target = new URL(selected.forwardTo);
        if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:')
          throw new Error('Fixture forwarding requires loopback HTTP');
        const delivered = await fetch(target.origin + req.url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-protobuf' },
          body,
          signal: AbortSignal.timeout(5000),
        });
        res.writeHead(delivered.status, { 'content-type': 'application/x-protobuf' });
        res.end(Buffer.from(await delivered.arrayBuffer()));
        return;
      }
      const send = () => {
        res.writeHead(selected.status, { 'content-type': 'application/x-protobuf' });
        res.end(); // Empty Export*ServiceResponse is valid protobuf.
      };
      if (selected.delayMs > 0) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          send();
        }, selected.delayMs);
        timers.add(timer);
      } else {
        send();
      }
    } catch {
      if (!res.headersSent) res.writeHead(400).end();
    }
  };
  const server = tls ? createSecureServer(tls, handler) : createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}`,
    requests,
    get discarded() {
      return discarded;
    },
    respond(next) {
      response = { status: 200, delayMs: 0, ...next };
    },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
