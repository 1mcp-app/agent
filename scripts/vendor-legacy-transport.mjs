import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';

const SDK_VERSION = '1.30.0';
const PATCH_HASH = '75c775371ba4b626db950c68d95331c6e8c9a3949d551aba01d9d1332cb82937';
const SOURCES = {
  'streamableHttp.js': 'e811d93af3f5e62497cf208ce162761c64cfd1c79fc4a0d8c77be59e0a77360b',
  'webStandardStreamableHttp.js': 'c4e3e9fab26e2a7dad55b4bba9598d7bb444f5f19fdef38b1a4982278e37174c',
};
const IMPORTS = {
  'streamableHttp.js': {
    '@hono/node-server': '@hono/node-server',
    './webStandardStreamableHttp.js': './webStandardStreamableHttp.js',
  },
  'webStandardStreamableHttp.js': {
    '../shared/mediaType.js': '@modelcontextprotocol/sdk/shared/mediaType.js',
    './sseKeepAlive.js': '@modelcontextprotocol/sdk/server/sseKeepAlive.js',
    '../types.js': '@modelcontextprotocol/sdk/types.js',
  },
};

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function transformTransport(name, source) {
  if (sha256(source) !== SOURCES[name]) throw new Error(`Unexpected pinned SDK source: ${name}`);
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gmu)].map((match) => match[1]);
  const expected = Object.keys(IMPORTS[name]);
  if (JSON.stringify(imports) !== JSON.stringify(expected)) throw new Error(`Unexpected SDK imports: ${name}`);
  let output = source;
  for (const [from, to] of Object.entries(IMPORTS[name])) {
    output = output.replace(`from '${from}';`, `from '${to}';`);
  }
  // Upstream maps point outside the generated island; retain exact code without dangling map links.
  return output.replace(/^\/\/# sourceMappingURL=.*\n?$/gmu, '');
}

export async function vendorLegacyTransport(root) {
  const read = (relative) => readFile(path.join(root, relative), 'utf8');
  const manifest = JSON.parse(await read('package.json'));
  if (manifest.dependencies['@modelcontextprotocol/sdk'] !== SDK_VERSION) throw new Error('Legacy SDK pin changed');
  if (manifest.dependencies['@hono/node-server'] !== '2.0.12') throw new Error('Legacy Node adapter pin changed');
  const patchPath = `patches/@modelcontextprotocol__sdk@${SDK_VERSION}.patch`;
  if (sha256(await read(patchPath)) !== PATCH_HASH) throw new Error('Legacy SDK patch changed');
  const lock = await read('pnpm-lock.yaml');
  if (!lock.includes(`hash: ${PATCH_HASH}\n    path: ${patchPath}`)) throw new Error('Legacy SDK patch lock changed');
  if (!lock.includes(`version: ${SDK_VERSION}(patch_hash=${PATCH_HASH})(zod@4.4.3)`)) {
    throw new Error('Legacy SDK installation lock changed');
  }
  if (!lock.includes("'@hono/node-server':\n        specifier: 2.0.12\n        version: 2.0.12(hono@4.12.34)")) {
    throw new Error('Legacy Node adapter installation lock changed');
  }
  const workspace = await read('pnpm-workspace.yaml');
  if (!workspace.includes(`'@modelcontextprotocol/sdk@${SDK_VERSION}': ${patchPath}`)) {
    throw new Error('Legacy SDK patch configuration changed');
  }
  const require = createRequire(path.join(root, 'package.json'));
  const sdkServer = path.dirname(require.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js'));
  const sdkRoot = path.resolve(sdkServer, '../../..');
  const sdkManifest = JSON.parse(await readFile(path.join(sdkRoot, 'package.json'), 'utf8'));
  if (sdkManifest.version !== SDK_VERSION) throw new Error('Installed legacy SDK version changed');
  const destination = path.join(root, 'build/sdk/legacy/server/retained-sdk');
  const files = {};
  const outputs = {};
  // Resolve via the package export but deliberately retain ESM, regardless of require conditions.
  for (const name of Object.keys(SOURCES)) {
    const source = await readFile(path.join(sdkRoot, 'dist/esm/server', name), 'utf8');
    outputs[name] = transformTransport(name, source);
    files[name] = { sourceSha256: sha256(source), generatedSha256: sha256(outputs[name]) };
  }
  const license = await readFile(path.join(sdkRoot, 'LICENSE'), 'utf8');
  const shim = path.join(root, 'build/sdk/legacy/server/streamableHttp.js');
  const compiled = await readFile(shim, 'utf8');
  const originalExport = "export * from '@modelcontextprotocol/sdk/server/streamableHttp.js';";
  if (!compiled.startsWith(originalExport)) throw new Error('Unexpected compiled legacy transport shim');
  await mkdir(destination, { recursive: true });
  for (const [name, output] of Object.entries(outputs)) await writeFile(path.join(destination, name), output);
  await writeFile(path.join(destination, 'LICENSE'), license);
  await writeFile(
    path.join(destination, 'provenance.json'),
    `${JSON.stringify(
      {
        package: '@modelcontextprotocol/sdk',
        version: SDK_VERSION,
        patchSha256: PATCH_HASH,
        transformation: 'public-import-specifiers-and-source-map-trailer-only',
        files,
        licenseSha256: sha256(license),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(shim, compiled.replace(originalExport, "export * from './retained-sdk/streamableHttp.js';"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await vendorLegacyTransport(process.cwd());
}
