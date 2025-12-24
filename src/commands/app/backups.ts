import {
  cleanupOldBackups,
  findBackupByMetaPath,
  listAppBackups,
  verifyBackupIntegrity,
} from '@src/domains/backup/backupManager.js';
import { getAppPreset } from '@src/domains/discovery/appPresets.js';
import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

/**
 * Backups command - Manage and list backup files.
 *
 * Provides backup management functionality including listing,
 * verification, and cleanup of old backup files.
 */

interface BackupsOptions extends GlobalOptions {
  'app-name'?: string;
  cleanup?: number;
  verify: boolean;
}

/**
 * Build the backups command configuration
 */
export function buildBackupsCommand(yargs: Argv) {
  return yargs
    .positional('app-name', {
      describe: 'Show backups for specific app only',
      type: 'string',
    })
    .option('cleanup', {
      describe: 'Remove backups older than specified days',
      type: 'number',
    })
    .option('verify', {
      describe: 'Verify backup file integrity',
      type: 'boolean',
      default: false,
    })
    .example([
      ['$0 app backups', 'List all available backups'],
      ['$0 app backups claude-desktop', 'List backups for specific app'],
      ['$0 app backups --cleanup=30', 'Remove backups older than 30 days'],
      ['$0 app backups --verify', 'Verify backup integrity'],
    ]);
}

/**
 * Main backups command handler
 */
export async function backupsCommand(options: BackupsOptions): Promise<void> {
  printer.title('MCP Configuration Backup Management');
  printer.blank();

  // Cleanup mode
  if (options.cleanup !== undefined) {
    await cleanupBackups(options.cleanup);
    return;
  }

  // List and optionally verify backups
  await listBackupsWithDetails(options['app-name'], options.verify);
}

/**
 * List backups with detailed information
 */
async function listBackupsWithDetails(appName?: string, verify: boolean = false): Promise<void> {
  const backups = listAppBackups(appName);

  if (backups.length === 0) {
    if (appName) {
      printer.info(`No backups found for ${appName}.`);
    } else {
      printer.info('No backups found.');
    }
    printer.blank();
    printer.info('Backups are created automatically during consolidation.');
    return;
  }

  if (appName) {
    const preset = getAppPreset(appName);
    printer.title(`Backups for ${preset?.displayName || appName}:`);
  } else {
    printer.title('All Available Backups:');
  }

  // Group by application
  const groupedBackups = backups.reduce(
    (groups, backup) => {
      if (!groups[backup.app]) {
        groups[backup.app] = [];
      }
      groups[backup.app].push(backup);
      return groups;
    },
    {} as Record<string, typeof backups>,
  );

  let totalSize = 0;
  let verifiedCount = 0;
  let corruptedCount = 0;

  for (const [app, appBackups] of Object.entries(groupedBackups)) {
    const preset = getAppPreset(app);
    printer.raw(`📱 ${preset?.displayName || app} (${app}):`);

    for (const backup of appBackups) {
      const backupInfo = findBackupByMetaPath(backup.metaPath);

      printer.raw(`   🕐 ${backup.age} - ${backup.operation} operation`);
      printer.raw(`      📁 ${backup.backupPath}`);
      printer.raw(`      🔧 ${backup.serverCount} servers backed up`);

      if (backupInfo) {
        const fileSizeKB = Math.round(backupInfo.metadata.fileSize / 1024);
        totalSize += backupInfo.metadata.fileSize;
        printer.raw(`      📊 Size: ${fileSizeKB} KB`);

        // Verify integrity if requested
        if (verify) {
          const isValid = verifyBackupIntegrity(backupInfo);
          if (isValid) {
            printer.raw(`      ✅ Integrity: Valid`);
            verifiedCount++;
          } else {
            printer.raw(`      ❌ Integrity: Corrupted`);
            corruptedCount++;
          }
        }
      }

      printer.raw(`      📝 Metadata: ${backup.metaPath}`);
      printer.blank();
    }
  }

  // Summary
  const totalSizeMB = Math.round((totalSize / (1024 * 1024)) * 100) / 100;
  printer.blank();
  printer.subtitle('Backup Summary:');
  printer.info(`   Total backups: ${backups.length}`);
  printer.info(`   Applications: ${Object.keys(groupedBackups).length}`);
  printer.info(`   Total size: ${totalSizeMB} MB`);

  if (verify) {
    printer.success(`   Verified: ${verifiedCount}`);
    if (corruptedCount > 0) {
      printer.error(`   Corrupted: ${corruptedCount}`);
    }
  }

  // Show oldest and newest
  if (backups.length > 1) {
    const oldest = backups[backups.length - 1];
    const newest = backups[0];
    printer.info(`   Oldest: ${oldest.age} (${getAppPreset(oldest.app)?.displayName || oldest.app})`);
    printer.info(`   Newest: ${newest.age} (${getAppPreset(newest.app)?.displayName || newest.app})`);
  }

  // Usage recommendations
  printer.blank();
  printer.info('Management Commands:');
  printer.info('   List app backups: npx @1mcp/agent app backups <app-name>');
  printer.info('   Verify integrity: npx @1mcp/agent app backups --verify');
  printer.info('   Cleanup old: npx @1mcp/agent app backups --cleanup=30');
  printer.info('   Restore: npx @1mcp/agent app restore <app-name>');

  if (corruptedCount > 0) {
    printer.blank();
    printer.warn('Warning: Some backups failed integrity verification.');
    printer.info('   Consider creating fresh backups for affected applications.');
  }
}

/**
 * Cleanup old backups
 */
async function cleanupBackups(maxAgeDays: number): Promise<void> {
  printer.info(`Cleaning up backups older than ${maxAgeDays} days...`);
  printer.blank();

  if (maxAgeDays < 1) {
    printer.error('Invalid age: must be at least 1 day.');
    process.exit(1);
  }

  // Show what will be deleted first
  const allBackups = listAppBackups();
  const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const oldBackups = allBackups.filter((backup) => backup.timestamp < cutoffTime);

  if (oldBackups.length === 0) {
    printer.success(`No backups older than ${maxAgeDays} days found.`);
    return;
  }

  printer.info(`Found ${oldBackups.length} backups to delete:`);
  printer.blank();

  const groupedOld = oldBackups.reduce(
    (groups, backup) => {
      if (!groups[backup.app]) {
        groups[backup.app] = [];
      }
      groups[backup.app].push(backup);
      return groups;
    },
    {} as Record<string, typeof oldBackups>,
  );

  Object.entries(groupedOld).forEach(([app, appBackups]) => {
    const preset = getAppPreset(app);
    printer.raw(`📱 ${preset?.displayName || app}: ${appBackups.length} backups`);
    appBackups.forEach((backup) => {
      printer.raw(`   🕐 ${backup.age} - ${backup.operation}`);
    });
  });

  // Perform cleanup
  printer.blank();
  printer.info('Deleting old backups...');
  const deletedCount = cleanupOldBackups(maxAgeDays);

  if (deletedCount > 0) {
    printer.success(`Successfully deleted ${deletedCount} old backups.`);

    // Show remaining backups
    const remainingBackups = listAppBackups();
    printer.info(`Remaining backups: ${remainingBackups.length}`);

    if (remainingBackups.length > 0) {
      const totalSize = remainingBackups.reduce((sum, backup) => {
        const backupInfo = findBackupByMetaPath(backup.metaPath);
        return sum + (backupInfo?.metadata.fileSize || 0);
      }, 0);
      const totalSizeMB = Math.round((totalSize / (1024 * 1024)) * 100) / 100;
      printer.info(`Total size: ${totalSizeMB} MB`);
    }
  } else {
    printer.warn('No backups were deleted (they may have been removed already).');
  }

  printer.blank();
  printer.info('To see remaining backups: npx @1mcp/agent app backups');
}
