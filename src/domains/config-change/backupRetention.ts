import fs from 'fs';
import path from 'path';

import type { ConfigRetentionCleanupResult } from './types.js';

export interface BackupRetentionPolicy {
  keepLatest: number;
  maxAgeDays: number;
}

interface BackupFile {
  path: string;
  timestamp: number;
}

export const DEFAULT_BACKUP_RETENTION: BackupRetentionPolicy = {
  keepLatest: 10,
  maxAgeDays: 30,
};

export function retentionSkipped(): ConfigRetentionCleanupResult {
  return {
    attempted: false,
    deletedPaths: [],
    warnings: [],
  };
}

export function listConfigBackups(configPath: string): BackupFile[] {
  const configDir = path.dirname(configPath);
  const backupPrefix = `${path.basename(configPath)}.backup.`;
  if (!fs.existsSync(configDir)) {
    return [];
  }

  return fs
    .readdirSync(configDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(backupPrefix))
    .map((entry) => {
      const timestamp = Number(entry.name.slice(backupPrefix.length));
      if (!Number.isFinite(timestamp)) {
        return null;
      }

      return {
        path: path.join(configDir, entry.name),
        timestamp,
      };
    })
    .filter((entry): entry is BackupFile => entry !== null)
    .sort((left, right) => right.timestamp - left.timestamp);
}
