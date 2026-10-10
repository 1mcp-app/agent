import { constants } from 'node:fs';
import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { createRequire } from 'node:module';
import { z } from 'zod';

export interface CodeGraphInstallation {
  readonly nodeExecutable: string;
  readonly libraryRoot: string;
  readonly version: string;
}

export const VERIFIED_CODEGRAPH_VERSION = '1.6.2';

/** Resolves installed bytes only. Never invoke the npm download/self-heal shim. */
export async function resolveCodeGraphInstallation(executable: string): Promise<CodeGraphInstallation> {
  if (!path.isAbsolute(executable)) throw new Error('CodeGraph executable must be an absolute installed path.');
  const resolved = await realpath(executable);
  let bundleRoot: string;
  if (path.basename(resolved) === 'npm-shim.js') {
    const packageRoot = path.dirname(resolved);
    await verifyVersion(path.join(packageRoot, 'package.json'));
    const requireInstalled = createRequire(resolved);
    const packageManifest = requireInstalled.resolve(
      `@colbymchenry/codegraph-${process.platform}-${process.arch}/package.json`,
    );
    bundleRoot = path.dirname(packageManifest);
    await verifyVersion(packageManifest);
  } else if (path.basename(path.dirname(resolved)) === 'bin' && path.basename(resolved) === 'codegraph') {
    bundleRoot = path.dirname(path.dirname(resolved));
    await verifyVersion(path.join(bundleRoot, 'lib', 'package.json'));
  } else {
    throw new Error(
      'CodeGraph preparation supports the verified installed npm or standalone bundle; this executable layout is unsupported.',
    );
  }
  const nodeExecutable = path.join(bundleRoot, process.platform === 'win32' ? 'node.exe' : 'node');
  const libraryRoot = path.join(bundleRoot, 'lib', 'dist');
  await Promise.all([
    access(nodeExecutable, constants.X_OK),
    access(path.join(libraryRoot, 'index.js'), constants.R_OK),
    access(path.join(libraryRoot, 'mcp', 'writer-lock.js'), constants.R_OK),
  ]);
  return { nodeExecutable, libraryRoot, version: VERIFIED_CODEGRAPH_VERSION };
}

async function verifyVersion(manifestPath: string): Promise<void> {
  const manifest = z
    .object({ version: z.literal(VERIFIED_CODEGRAPH_VERSION) })
    .safeParse(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (!manifest.success) {
    throw new Error(
      `CodeGraph preparation is verified for ${VERIFIED_CODEGRAPH_VERSION}; configure that installed bundle or verify an adapter for this version.`,
    );
  }
}
