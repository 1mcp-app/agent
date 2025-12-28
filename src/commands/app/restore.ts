import readline from 'readline';

import { findBackupByMetaPath, listAppBackups, rollbackFromBackupPath } from '@src/domains/backup/backupManager.js';
import { getAppPreset, isAppSupported } from '@src/domains/discovery/appPresets.js';
import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

/**
 * Restore command - Restore desktop applications to pre-consolidation state.
 *
 * Restores original application configurations from backups created
 * during the consolidation process.
 */

interface RestoreOptions extends GlobalOptions {
  'app-name'?: string;
  backup?: string;
  list: boolean;
  all: boolean;
  'keep-in-1mcp': boolean;
  'dry-run': boolean;
  yes: boolean;
}

interface RestoreResult {
  app: string;
  status: 'success' | 'failed' | 'skipped';
  message: string;
  backupPath?: string;
}

/**
 * Build the restore command configuration
 */
export function buildRestoreCommand(yargs: Argv) {
  return yargs
    .positional('app-name', {
      describe: 'Desktop app to restore (claude-desktop, cursor, vscode, etc.)',
      type: 'string',
    })
    .option('backup', {
      describe: 'Specific backup file to restore from',
      type: 'string',
      alias: 'b',
    })
    .option('list', {
      describe: 'List available backups for app',
      type: 'boolean',
      default: false,
      alias: 'l',
    })
    .option('all', {
      describe: 'Restore all apps that were consolidated',
      type: 'boolean',
      default: false,
      alias: 'a',
    })
    .option('keep-in-1mcp', {
      describe: "Don't remove servers from 1mcp config (keep both)",
      type: 'boolean',
      default: false,
    })
    .option('dry-run', {
      describe: 'Preview restore without making changes',
      type: 'boolean',
      default: false,
    })
    .option('yes', {
      describe: 'Skip confirmation prompts',
      type: 'boolean',
      default: false,
      alias: 'y',
    })
    .example([
      ['$0 app restore claude-desktop', 'Restore Claude Desktop configuration'],
      ['$0 app restore cursor --list', 'List available backups for Cursor'],
      ['$0 app restore --all --dry-run', 'Preview restoring all apps'],
      ['$0 app restore --backup=./config.backup.1640995200000.meta', 'Restore from specific backup'],
    ]).epilogue(`
WHAT IT DOES:
  1. Finds backup files created during consolidation
  2. Restores original app configuration from backup
  3. Validates restored configuration works correctly
  4. Optionally removes imported servers from 1mcp config

EXAMPLE WORKFLOW:
  Current: Claude Desktop → 1mcp → [filesystem, postgres, sequential] servers
  After:   Claude Desktop → [filesystem, postgres, sequential] servers directly
    `);
}

/**
 * Main restore command handler
 */
export async function restoreCommand(options: RestoreOptions): Promise<void> {
  printer.info('Starting MCP configuration restoration...');
  printer.blank();

  // List mode
  if (options.list) {
    await listBackups(options['app-name']);
    return;
  }

  // Restore from specific backup file
  if (options.backup) {
    await restoreFromBackupFile(options.backup, options);
    return;
  }

  // Restore all apps
  if (options.all) {
    await restoreAllApps(options);
    return;
  }

  // Restore specific app
  if (options['app-name']) {
    await restoreSpecificApp(options['app-name'], options);
    return;
  }

  // No specific action - show available options
  printer.info('Please specify what to restore:');
  printer.info('   --list                     List available backups');
  printer.info('   --all                      Restore all backed up apps');
  printer.info('   --backup <path>            Restore from specific backup file');
  printer.info('   <app-name>                 Restore specific app');
  printer.blank();
  printer.info('Use --help for more options.');
}

/**
 * List available backups
 */
async function listBackups(appName?: string): Promise<void> {
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
    printer.title(`Available backups for ${getAppPreset(appName)?.displayName || appName}:`);
  } else {
    printer.title('Available backups:');
  }

  // Group by app
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

  Object.entries(groupedBackups).forEach(([app, appBackups]) => {
    const preset = getAppPreset(app);
    printer.raw(`📱 ${preset?.displayName || app} (${app}):`);

    appBackups.forEach((backup) => {
      printer.raw(`   🕐 ${backup.age} - ${backup.operation} operation`);
      printer.raw(`      📁 ${backup.backupPath}`);
      printer.raw(`      🔧 ${backup.serverCount} servers backed up`);
      printer.blank();
    });
  });

  printer.info(`Total: ${backups.length} backups available`);

  printer.blank();
  printer.info('To restore:');
  printer.info('   npx @1mcp/agent app restore <app-name>');
  printer.info('   npx @1mcp/agent app restore --backup <backup-file.meta>');
}

/**
 * Restore from specific backup file
 */
async function restoreFromBackupFile(backupPath: string, options: RestoreOptions): Promise<void> {
  try {
    const backupInfo = findBackupByMetaPath(backupPath);

    if (!backupInfo) {
      printer.error(`Backup metadata not found or invalid: ${backupPath}`);
      process.exit(1);
    }

    printer.info(`Restoring from backup: ${backupPath}`);
    printer.info(`App: ${getAppPreset(backupInfo.metadata.app)?.displayName || backupInfo.metadata.app}`);
    printer.info(`Original path: ${backupInfo.originalPath}`);
    printer.info(`Created: ${new Date(backupInfo.timestamp).toLocaleString()}`);
    printer.info(`Servers: ${backupInfo.metadata.serverCount}`);

    // Dry run
    if (options['dry-run']) {
      printer.blank();
      printer.info('Dry Run - would restore configuration to:');
      printer.info(`   ${backupInfo.originalPath}`);
      return;
    }

    // Confirmation
    if (!options.yes) {
      const confirmed = await confirmRestore();
      if (!confirmed) {
        printer.info('Restore cancelled by user.');
        return;
      }
    }

    // Perform restore
    await rollbackFromBackupPath(backupPath);

    printer.success(
      `Successfully restored ${getAppPreset(backupInfo.metadata.app)?.displayName || backupInfo.metadata.app}`,
    );
    printer.info('Restart the application to use the restored configuration.');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    printer.error(`Restore failed: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Restore all applications
 */
async function restoreAllApps(options: RestoreOptions): Promise<void> {
  const backups = listAppBackups();

  if (backups.length === 0) {
    printer.info('No backups found to restore.');
    return;
  }

  // Get latest backup for each app
  const latestBackups = backups.reduce(
    (latest, backup) => {
      if (!latest[backup.app] || backup.timestamp > latest[backup.app].timestamp) {
        latest[backup.app] = backup;
      }
      return latest;
    },
    {} as Record<string, (typeof backups)[0]>,
  );

  const appsToRestore = Object.keys(latestBackups);
  printer.info(`Found backups for ${appsToRestore.length} applications:`);
  appsToRestore.forEach((app) => {
    const preset = getAppPreset(app);
    printer.raw(`   📱 ${preset?.displayName || app}`);
  });

  // Confirmation
  if (!options.yes && !options['dry-run']) {
    const confirmed = await confirmRestore();
    if (!confirmed) {
      printer.info('Restore cancelled by user.');
      return;
    }
  }

  printer.blank();
  const results: RestoreResult[] = [];

  // Restore each app
  for (const app of appsToRestore) {
    const backup = latestBackups[app];
    printer.info(`Restoring ${getAppPreset(app)?.displayName || app}...`);

    try {
      if (options['dry-run']) {
        printer.info(`   Would restore from: ${backup.backupPath}`);
        results.push({
          app,
          status: 'success',
          message: 'Dry run completed',
        });
      } else {
        await rollbackFromBackupPath(backup.backupPath);
        printer.success(`   Restored successfully`);
        results.push({
          app,
          status: 'success',
          message: 'Restored successfully',
          backupPath: backup.backupPath,
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      printer.error(`Failed: ${errorMessage}`);
      results.push({
        app,
        status: 'failed',
        message: errorMessage,
      });
    }
  }

  // Summary
  printer.blank();
  printer.raw('='.repeat(60));
  printer.title('Restore Summary:');

  const successful = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'failed');

  printer.success(`Successful: ${successful.length}`);
  printer.error(`Failed: ${failed.length}`);

  if (successful.length > 0 && !options['dry-run']) {
    printer.blank();
    printer.info('Restart the following applications to use restored configurations:');
    successful.forEach((result) => {
      printer.raw(`   - ${getAppPreset(result.app)?.displayName || result.app}`);
    });
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

/**
 * Restore specific application
 */
async function restoreSpecificApp(appName: string, options: RestoreOptions): Promise<void> {
  if (!isAppSupported(appName)) {
    printer.error(`Unsupported application: ${appName}`);
    printer.info('Use "npx @1mcp/agent app list" to see supported applications.');
    process.exit(1);
  }

  const backups = listAppBackups(appName);

  if (backups.length === 0) {
    printer.info(`No backups found for ${getAppPreset(appName)?.displayName || appName}.`);
    printer.blank();
    printer.info('Backups are created automatically during consolidation.');
    return;
  }

  // Use most recent backup
  const latestBackup = backups[0]; // Already sorted by timestamp descending

  printer.info(`Restoring ${getAppPreset(appName)?.displayName || appName}...`);
  printer.info(`Backup: ${latestBackup.backupPath}`);
  printer.info(`Created: ${latestBackup.age}`);
  printer.info(`Servers: ${latestBackup.serverCount}`);

  // Dry run
  if (options['dry-run']) {
    printer.blank();
    printer.info('Dry Run - would restore configuration.');
    return;
  }

  // Confirmation
  if (!options.yes) {
    const confirmed = await confirmRestore();
    if (!confirmed) {
      printer.info('Restore cancelled by user.');
      return;
    }
  }

  try {
    await rollbackFromBackupPath(latestBackup.backupPath);

    printer.success(`Successfully restored ${getAppPreset(appName)?.displayName || appName}`);
    printer.info('Restart the application to use the restored configuration.');

    if (!options['keep-in-1mcp']) {
      printer.blank();
      printer.info('Note: Servers remain in 1mcp configuration.');
      printer.info('   To remove them: npx @1mcp/agent server remove <server-name>');
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    printer.error(`Restore failed: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Confirm restore operation with user
 */
async function confirmRestore(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('\nAre you sure you want to restore? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
