import semver from 'semver';

/**
 * Version parsing, comparison, and resolution utilities
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export type UpdateType = 'major' | 'minor' | 'patch';

/**
 * Parse semantic version string into components
 */
export function parseVersion(version: string): ParsedVersion | null {
  const parsed = semver.parse(version);
  if (!parsed) {
    return null;
  }

  return {
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
  };
}

/**
 * Compare two semantic versions
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  // Clean versions to handle 'v' prefix and other formats
  const clean1 = semver.clean(v1);
  const clean2 = semver.clean(v2);

  if (!clean1 || !clean2) {
    return 0;
  }

  return semver.compare(clean1, clean2);
}

/**
 * Determine update type based on version comparison
 * Returns the type of update (major/minor/patch) if newVersion > currentVersion, undefined otherwise
 */
export function getUpdateType(currentVersion: string, newVersion: string): UpdateType | undefined {
  const clean1 = semver.clean(currentVersion);
  const clean2 = semver.clean(newVersion);

  if (!clean1 || !clean2) {
    return undefined;
  }

  // First check if new version is actually greater
  if (!semver.gt(clean2, clean1)) {
    return undefined;
  }

  // Now determine the type of update
  const diff = semver.diff(clean1, clean2);

  if (diff === 'major' || diff === 'premajor') {
    return 'major';
  }

  if (diff === 'minor' || diff === 'preminor') {
    return 'minor';
  }

  if (diff === 'patch' || diff === 'prepatch') {
    return 'patch';
  }

  return undefined;
}

/**
 * Check if a version is valid semver
 */
export function isValidVersion(version: string): boolean {
  return semver.valid(version) !== null;
}

/**
 * Clean version string (remove 'v' prefix, etc.)
 */
export function cleanVersion(version: string): string | null {
  return semver.clean(version);
}

/**
 * Check if version1 is greater than version2
 */
export function isNewerVersion(v1: string, v2: string): boolean {
  return compareVersions(v1, v2) > 0;
}
