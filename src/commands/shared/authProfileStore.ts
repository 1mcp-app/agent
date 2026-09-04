import { createHash, randomBytes } from 'node:crypto';
import { access, chmod, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getConfigDir } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import {
  assertOwnerOnlyDirPermissionsAsync,
  CAPABILITY_ERROR_CODES,
  InsecureFilePermissionsError,
  readCredentialFile,
} from '@src/utils/filePermissions.js';

const AUTH_PROFILES_DIR = 'auth-profiles';

export interface AuthProfile {
  serverUrl: string;
  token: string;
  savedAt: number;
  label?: string;
}

/**
 * Normalize a server URL for consistent keying.
 * Strips /mcp suffix, trailing slash, query params, and lowercases the host.
 */
export function normalizeServerUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    let normalized = parsed.toString().replace(/\/$/, '');
    // Strip /mcp suffix
    if (normalized.endsWith('/mcp')) {
      normalized = normalized.slice(0, -4);
    }
    return normalized;
  } catch {
    return url
      .toLowerCase()
      .replace(/\/$/, '')
      .replace(/\/mcp$/, '');
  }
}

function profileKey(serverUrl: string): string {
  const normalized = normalizeServerUrl(serverUrl);
  return createHash('sha256').update(normalized).digest('hex');
}

function profilesDir(configDir?: string): string {
  return path.join(getConfigDir(configDir), AUTH_PROFILES_DIR);
}

function profilePath(configDir: string | undefined, serverUrl: string): string {
  return path.join(profilesDir(configDir), `${profileKey(serverUrl)}.json`);
}

export async function saveAuthProfile(configDir: string | undefined, profile: AuthProfile): Promise<void> {
  // Auth profiles carry bearer tokens: dir 0700, file 0600 (POSIX; ignored on win32).
  const dir = profilesDir(configDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Write-side directory gate: mkdir mode does not tighten a pre-existing permissive dir,
  // so heal-or-fail-closed before the profile lands in it (same policy as the read side).
  await assertOwnerOnlyDirPermissionsAsync(dir);
  const filePath = profilePath(configDir, profile.serverUrl);
  const tempPath = `${filePath}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  const data: AuthProfile = {
    ...profile,
    serverUrl: normalizeServerUrl(profile.serverUrl),
  };
  try {
    await writeFile(tempPath, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  // Post-rename chmod: tolerate volumes without POSIX modes (exFAT/CIFS/some FUSE)
  // with the same capability-error degradation policy as the read side in
  // filePermissions.ts, so a successful save is not reported as failed there;
  // real denials (EACCES/EPERM) still throw.
  try {
    await chmod(filePath, 0o600);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && CAPABILITY_ERROR_CODES.has(code)) {
      logger.warn(`chmod unsupported on auth-profiles volume (${code}); profile saved without mode hardening`);
    } else {
      throw error;
    }
  }
}

export async function loadAuthProfile(configDir: string | undefined, serverUrl: string): Promise<AuthProfile | null> {
  try {
    const filePath = profilePath(configDir, serverUrl);
    // Read-side strictModes: heal legacy permissive files to 0600, refuse the
    // credential only when the heal is denied.
    const raw = await readCredentialFile(filePath, profilesDir(configDir));
    const parsed = JSON.parse(raw) as unknown;
    if (!isAuthProfile(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error instanceof InsecureFilePermissionsError) {
      throw error;
    }
    return null;
  }
}

export async function deleteAuthProfile(configDir: string | undefined, serverUrl: string): Promise<boolean> {
  try {
    const filePath = profilePath(configDir, serverUrl);
    await access(filePath);
    await rm(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function listAuthProfiles(configDir?: string): Promise<AuthProfile[]> {
  const dir = profilesDir(configDir);
  try {
    // Directory gate before enumeration: listing reveals which credential IDs
    // exist, so heal/assert the dir 0700 first (same invariant as readData and
    // cleanupExpiredData). A denied heal throws InsecureFilePermissionsError,
    // caught below to return [] — fail-closed, no enumeration.
    await assertOwnerOnlyDirPermissionsAsync(dir);
    const files = await readdir(dir);
    const results = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          try {
            const raw = await readCredentialFile(path.join(dir, file), dir);
            const parsed = JSON.parse(raw) as unknown;
            return isAuthProfile(parsed) ? parsed : null;
          } catch (error) {
            if (error instanceof InsecureFilePermissionsError) {
              // Fail-closed on consume, but do not nuke the whole listing:
              // skip this profile, keep the healthy ones visible.
              logger.warn(`Skipping auth profile with unfixable permissions: ${error.message}`);
              return null;
            }
            return null;
          }
        }),
    );
    return results.filter((p): p is AuthProfile => p !== null);
  } catch {
    return [];
  }
}

function isAuthProfile(value: unknown): value is AuthProfile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'serverUrl' in value &&
    typeof (value as Record<string, unknown>).serverUrl === 'string' &&
    'token' in value &&
    typeof (value as Record<string, unknown>).token === 'string' &&
    'savedAt' in value &&
    typeof (value as Record<string, unknown>).savedAt === 'number'
  );
}
