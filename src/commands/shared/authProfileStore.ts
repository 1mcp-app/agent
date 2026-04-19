import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getConfigDir } from '@src/constants.js';

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
  const dir = profilesDir(configDir);
  await mkdir(dir, { recursive: true });
  const filePath = profilePath(configDir, profile.serverUrl);
  const tempPath = `${filePath}.tmp.${process.pid}`;
  const data: AuthProfile = {
    ...profile,
    serverUrl: normalizeServerUrl(profile.serverUrl),
  };
  await writeFile(tempPath, JSON.stringify(data), 'utf8');
  await rename(tempPath, filePath);
}

export async function loadAuthProfile(configDir: string | undefined, serverUrl: string): Promise<AuthProfile | null> {
  try {
    const filePath = profilePath(configDir, serverUrl);
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isAuthProfile(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteAuthProfile(configDir: string | undefined, serverUrl: string): Promise<boolean> {
  try {
    const filePath = profilePath(configDir, serverUrl);
    await rm(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function listAuthProfiles(configDir?: string): Promise<AuthProfile[]> {
  const dir = profilesDir(configDir);
  try {
    const files = await readdir(dir);
    const results = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          try {
            const raw = await readFile(path.join(dir, file), 'utf8');
            const parsed = JSON.parse(raw) as unknown;
            return isAuthProfile(parsed) ? parsed : null;
          } catch {
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
