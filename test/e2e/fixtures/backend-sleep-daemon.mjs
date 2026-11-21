import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ pid: process.pid }));
});
server.listen(0, '127.0.0.1', () => {
  writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, port: server.address().port }));
});
process.on('SIGTERM', () => server.close());
