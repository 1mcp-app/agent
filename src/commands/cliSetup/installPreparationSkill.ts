import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { preparationSkillFiles } from './preparationSkill.generated.js';

const SKILL_NAME = '1mcp-preparation-setup';
const MANIFEST = '.1mcp-managed.json';
const relativeFile = z.string().refine((value) => {
  if (value === MANIFEST) return false;
  return value.split('/').every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part));
});
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  skill: z.literal(SKILL_NAME),
  files: z.record(relativeFile, z.string().regex(/^[a-f0-9]{64}$/)),
  pendingFiles: z.record(relativeFile, z.string().regex(/^[a-f0-9]{64}$/)).optional(),
});

export interface SkillInstallResult {
  path: string;
  changed: boolean;
  status: 'installed' | 'updated' | 'unchanged' | 'conflict';
  reason?: string;
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function statIfPresent(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

// Check every component below the selected scope, including dangling symlinks.
async function pathConflict(root: string, file: string, directory: boolean): Promise<string | undefined> {
  // The caller selected this root; aliases to it are valid, unlike redirects beneath it.
  try {
    if (!(await stat(root)).isDirectory()) return `Expected a directory: ${root}`;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  const relative = path.relative(root, file);
  const parts = relative ? relative.split(path.sep) : [];
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = await statIfPresent(current);
    if (!stat) return undefined;
    if (stat.isSymbolicLink()) return `Symlink preserved: ${current}`;
    const needsDirectory = index < parts.length - 1 || directory;
    if (needsDirectory && !stat.isDirectory()) return `Expected a directory: ${current}`;
    if (!needsDirectory && !stat.isFile()) return `Expected a regular file: ${current}`;
  }
  return undefined;
}

async function writeAtomically(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }
}

export async function installPreparationSkill(
  scopeRoot: string,
  skillsRelativePath: string,
  files: Readonly<Record<string, string>> = preparationSkillFiles,
): Promise<SkillInstallResult> {
  const root = path.resolve(scopeRoot);
  const destination = path.join(root, skillsRelativePath, SKILL_NAME);
  const conflict = (reason: string): SkillInstallResult => ({
    path: destination,
    changed: false,
    status: 'conflict',
    reason,
  });
  const directoryConflict = await pathConflict(root, destination, true);
  if (directoryConflict) return conflict(directoryConflict);

  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const lockPath = `${destination}.install-lock`;
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return conflict(
        `Installation lock exists: ${lockPath}. Confirm its installer stopped before removing the lock and retrying.`,
      );
    }
    throw error;
  }
  try {
    return await installUnderLock(root, destination, lockPath, files);
  } finally {
    await rm(path.join(lockPath, 'staging'), { recursive: true, force: true });
    await rmdir(lockPath);
  }
}

async function installUnderLock(
  root: string,
  destination: string,
  lockPath: string,
  files: Readonly<Record<string, string>>,
): Promise<SkillInstallResult> {
  const conflict = (reason: string): SkillInstallResult => ({
    path: destination,
    changed: false,
    status: 'conflict',
    reason,
  });
  const directoryConflict = await pathConflict(root, destination, true);
  if (directoryConflict) return conflict(directoryConflict);
  const exists = await statIfPresent(destination);
  const manifestPath = path.join(destination, MANIFEST);
  let previous: Record<string, string> = {};
  let previousManifest: string | undefined;
  let pending: Record<string, string> | undefined;
  if (exists) {
    const manifestConflict = await pathConflict(root, manifestPath, false);
    if (manifestConflict) return conflict(manifestConflict);
    if (!(await statIfPresent(manifestPath))) return conflict('Existing skill has no 1MCP ownership manifest');
    previousManifest = await readFile(manifestPath, 'utf8');
    try {
      const manifest = manifestSchema.parse(JSON.parse(previousManifest));
      previous = manifest.files;
      pending = manifest.pendingFiles;
    } catch {
      return conflict('Invalid 1MCP ownership manifest; existing skill preserved');
    }
    if (!previous['SKILL.md']) return conflict('Ownership manifest does not identify SKILL.md');
  }

  // Preflight the whole skill so one conflict cannot leave a partially upgraded recipe guide.
  const contents = new Map<string, string>();
  for (const relative of new Set([...Object.keys(previous), ...Object.keys(pending ?? {}), ...Object.keys(files)])) {
    relativeFile.parse(relative);
    const file = path.join(destination, relative);
    const fileConflict = await pathConflict(root, file, false);
    if (fileConflict) return conflict(fileConflict);
    if (!(await statIfPresent(file))) {
      // A missing pending addition may have been published and then deleted by the user.
      if (!previous[relative] && pending?.[relative]) return conflict(`Pending managed file is missing: ${relative}`);
      if (!previous[relative]) continue;
      if (pending && !Object.hasOwn(pending, relative)) continue;
      return conflict(`Managed file was removed: ${relative}`);
    }
    const content = await readFile(file, 'utf8');
    if (!previous[relative] && !pending?.[relative]) return conflict(`Unmanaged file preserved: ${relative}`);
    const hash = digest(content);
    if (hash !== previous[relative] && hash !== pending?.[relative])
      return conflict(`Locally edited file preserved: ${relative}`);
    contents.set(relative, content);
  }

  const nextManifest = `${JSON.stringify(
    {
      schemaVersion: 1,
      skill: SKILL_NAME,
      files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, digest(content)])),
    },
    null,
    2,
  )}\n`;
  if (previousManifest === nextManifest) return { path: destination, changed: false, status: 'unchanged' };
  const writeRoot = exists ? destination : path.join(lockPath, 'staging');
  if (exists) {
    // Journal both accepted and intended bytes before replacing any managed file.
    await writeAtomically(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          skill: SKILL_NAME,
          files: Object.fromEntries([...contents].map(([file, content]) => [file, digest(content)])),
          pendingFiles: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, digest(content)])),
        },
        null,
        2,
      )}\n`,
    );
  }
  for (const [relative, content] of Object.entries(files)) {
    if (contents.get(relative) === content) continue;
    await writeAtomically(path.join(writeRoot, relative), content);
  }
  for (const relative of contents.keys()) {
    if (Object.hasOwn(files, relative)) continue;
    await unlink(path.join(destination, relative));
  }
  await writeAtomically(path.join(writeRoot, MANIFEST), nextManifest);
  if (!exists) await rename(writeRoot, destination);
  return { path: destination, changed: true, status: exists ? 'updated' : 'installed' };
}
