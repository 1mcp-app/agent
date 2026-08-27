import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const mode = process.argv[2];

if (mode === 'invalid-probe' || mode === 'crash-probe' || mode === 'mismatched-revision-probe') {
  const attemptFile = process.argv[3];
  let attempts = 0;
  try {
    attempts = Number(await readFile(attemptFile, 'utf8')) || 0;
  } catch {
    attempts = 0;
  }
  await writeFile(attemptFile, String(attempts + 1));
  if (mode === 'invalid-probe') {
    process.stdout.write(`{"unexpected":"${process.argv[4]}"}\n`);
    process.exit(0);
  }
  if (mode === 'mismatched-revision-probe') {
    process.stdout.write(
      `${JSON.stringify({
        fixtureId: 'mismatched-revision',
        transport: 'streamable-http',
        initialized: true,
        ping: true,
        negotiatedRevision: '2024-11-05',
        operations: ['initialize', 'ping', 'tools/list', 'tools/call'],
        toolsCount: 1,
        callError: false,
      })}\n`,
    );
    process.exit(0);
  }
  process.exit(1);
}

if (mode === 'unused-stdio-peer') {
  process.stdin.resume();
  process.once('SIGTERM', () => process.exit(0));
} else {
  const portIndex = process.argv.indexOf('--port');
  const pidFileIndex = process.argv.indexOf('--fake-pid-file');
  const port = Number(process.argv[portIndex + 1]);
  if (pidFileIndex >= 0) await writeFile(process.argv[pidFileIndex + 1], String(process.pid));
  const server = createServer((request, response) => {
    request.resume();
    if (request.url === '/health/ready') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ready"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"jsonrpc":"2.0","id":1,"result":{}}');
  });
  server.listen(port, '127.0.0.1');
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
}
