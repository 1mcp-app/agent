import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Ephemeral test CA and identities; no production trust store changes. */
export async function createTlsFixture() {
  const directory = await mkdtemp(join(tmpdir(), '1mcp-otlp-tls-'));
  const file = (name) => join(directory, name);
  const openssl = (args) => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
  try {
    openssl([
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      'ca.key',
      '-out',
      'ca.crt',
      '-days',
      '1',
      '-subj',
      '/CN=1mcp Acceptance CA',
    ]);
    await writeFile(file('server.ext'), 'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
    await writeFile(file('client.ext'), 'extendedKeyUsage=clientAuth\n');
    for (const name of ['server', 'client']) {
      openssl([
        'req',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        `${name}.key`,
        '-out',
        `${name}.csr`,
        '-subj',
        `/CN=acceptance-${name}`,
      ]);
      openssl([
        'x509',
        '-req',
        '-in',
        `${name}.csr`,
        '-CA',
        'ca.crt',
        '-CAkey',
        'ca.key',
        '-CAcreateserial',
        '-out',
        `${name}.crt`,
        '-days',
        '1',
        '-extfile',
        `${name}.ext`,
      ]);
    }
    return {
      file,
      server: {
        ca: await readFile(file('ca.crt')),
        key: await readFile(file('server.key')),
        cert: await readFile(file('server.crt')),
      },
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
