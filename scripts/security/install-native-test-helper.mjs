import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// CI fixture installer, not runtime installation. Pinned primary release hashes.
const assets = {
  'darwin-arm64': [
    'docker-credential-osxkeychain-v0.9.9.darwin-arm64',
    '3585188b1df1c3568ae536999eddb48ad2c781b3cf07a2f7d7181262d045820c',
    'docker-credential-osxkeychain',
  ],
  'darwin-x64': [
    'docker-credential-osxkeychain-v0.9.9.darwin-amd64',
    '1be33ae30c8c80277bea3364d0d71afad411fa22e88bcabf3375550b989fd272',
    'docker-credential-osxkeychain',
  ],
  'linux-x64': [
    'docker-credential-secretservice-v0.9.9.linux-amd64',
    '134c34af84ba6397f2d47a0bf8a09ea493ac2aa69a913904e1df1c61d0f0e031',
    'docker-credential-secretservice',
  ],
  'win32-x64': [
    'docker-credential-wincred-v0.9.9.windows-amd64.exe',
    'ed50b9767eac0ba42782dc4f550ceab2f4354bacaad05c54caa9dec98a032c48',
    'docker-credential-wincred.exe',
  ],
};
const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination)) throw new Error('Supply an absolute CI fixture directory');
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset) throw new Error('Unsupported native credential CI fixture platform');
const response = await fetch(
  `https://github.com/docker/docker-credential-helpers/releases/download/v0.9.9/${asset[0]}`,
  { signal: AbortSignal.timeout(60000) },
);
if (!response.ok) throw new Error('Native credential helper download failed');
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== asset[1])
  throw new Error('Native credential helper checksum mismatch');
fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(destination, asset[2]), bytes, { mode: 0o700 });
console.log(`Installed verified native test helper ${asset[0]}`);
