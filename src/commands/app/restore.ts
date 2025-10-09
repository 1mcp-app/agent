import readline from 'readline';

import { GlobalOptions } from '@src/globalOptions.js';
import { getAppPreset, isAppSupported } from '@src/utils/discovery/appPresets.js';
import { findBackupByMetaPath, listAppBackups, rollbackFromBackupPath } from '@src/utils/management/backupManager.js';

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
  console.log('🔄 Starting MCP configuration restoration...\n');

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
  console.log('❓ Please specify what to restore:');
  console.log('   --list                     List available backups');
  console.log('   --all                      Restore all backed up apps');
  console.log('   --backup <path>            Restore from specific backup file');
  console.log('   <app-name>                 Restore specific app');
  console.log('\nUse --help for more options.');
}

/**
 * List available backups
 */
async function listBackups(appName?: string): Promise<void> {
  const backups = listAppBackups(appName);

  if (backups.length === 0) {
    if (appName) {
      console.log(`📭 No backups found for ${appName}.`);
    } else {
      console.log('📭 No backups found.');
    }
    console.log('\n💡 Backups are created automatically during consolidation.');
    return;
  }

  if (appName) {
    console.log(`📋 Available backups for ${getAppPreset(appName)?.displayName || appName}:\n`);
  } else {
    console.log('📋 Available backups:\n');
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
    console.log(`📱 ${preset?.displayName || app} (${app}):`);

    appBackups.forEach((backup) => {
      console.log(`   🕐 ${backup.age} - ${backup.operation} operation`);
      console.log(`      📁 ${backup.backupPath}`);
      console.log(`      🔧 ${backup.serverCount} servers backed up`);
      console.log();
    });
  });

  console.log(`📊 Total: ${backups.length} backups available`);

  console.log('\n💡 To restore:');
  console.log('   npx @1mcp/agent app restore <app-name>');
  console.log('   npx @1mcp/agent app restore --backup <backup-file.meta>');
}

/**
 * Restore from specific backup file
 */
async function restoreFromBackupFile(backupPath: string, options: RestoreOptions): Promise<void> {
  try {
    const backupInfo = findBackupByMetaPath(backupPath);

    if (!backupInfo) {
      console.error(`❌ Backup metadata not found or invalid: ${backupPath}`);
      process.exit(1);
    }

    console.log(`🔄 Restoring from backup: ${backupPath}`);
    console.log(`📱 App: ${getAppPreset(backupInfo.metadata.app)?.displayName || backupInfo.metadata.app}`);
    console.log(`📁 Original path: ${backupInfo.originalPath}`);
    console.log(`🕐 Created: ${new Date(backupInfo.timestamp).toLocaleString()}`);
    console.log(`🔧 Servers: ${backupInfo.metadata.serverCount}`);

    // Dry run
    if (options['dry-run']) {
      console.log('\n📋 Dry Run - would restore configuration to:');
      console.log(`   ${backupInfo.originalPath}`);
      return;
    }

    // Confirmation
    if (!options.yes) {
      const confirmed = await confirmRestore();
      if (!confirmed) {
        console.log('⏭️ Restore cancelled by user.');
        return;
      }
    }

    // Perform restore
    await rollbackFromBackupPath(backupPath);

    console.log(
      `✅ Successfully restored ${getAppPreset(backupInfo.metadata.app)?.displayName || backupInfo.metadata.app}`,
    );
    console.log('🔄 Restart the application to use the restored configuration.');
  } catch (error: any) {
    console.error(`❌ Restore failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Restore all applications
 */
async function restoreAllApps(options: RestoreOptions): Promise<void> {
  const backups = listAppBackups();

  if (backups.length === 0) {
    console.log('📭 No backups found to restore.');
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
  console.log(`🔄 Found backups for ${appsToRestore.length} applications:`);
  appsToRestore.forEach((app) => {
    const preset = getAppPreset(app);
    console.log(`   📱 ${preset?.displayName || app}`);
  });

  // Confirmation
  if (!options.yes && !options['dry-run']) {
    const confirmed = await confirmRestore();
    if (!confirmed) {
      console.log('⏭️ Restore cancelled by user.');
      return;
    }
  }

  console.log();
  const results: RestoreResult[] = [];

  // Restore each app
  for (const app of appsToRestore) {
    const backup = latestBackups[app];
    console.log(`🔄 Restoring ${getAppPreset(app)?.displayName || app}...`);

    try {
      if (options['dry-run']) {
        console.log(`   📋 Would restore from: ${backup.backupPath}`);
        results.push({
          app,
          status: 'success',
          message: 'Dry run completed',
        });
      } else {
        await rollbackFromBackupPath(backup.backupPath);
        console.log(`   ✅ Restored successfully`);
        results.push({
          app,
          status: 'success',
          message: 'Restored successfully',
          backupPath: backup.backupPath,
        });
      }
    } catch (error: any) {
      console.error(`   ❌ Failed: ${error.message}`);
      results.push({
        app,
        status: 'failed',
        message: error.message,
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Restore Summary:');

  const successful = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'failed');

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);

  if (successful.length > 0 && !options['dry-run']) {
    console.log('\n🔄 Restart the following applications to use restored configurations:');
    successful.forEach((result) => {
      console.log(`   - ${getAppPreset(result.app)?.displayName || result.app}`);
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
    console.error(`❌ Unsupported application: ${appName}`);
    console.log('Use "npx @1mcp/agent app list" to see supported applications.');
    process.exit(1);
  }

  const backups = listAppBackups(appName);

  if (backups.length === 0) {
    console.log(`📭 No backups found for ${getAppPreset(appName)?.displayName || appName}.`);
    console.log('\n💡 Backups are created automatically during consolidation.');
    return;
  }

  // Use most recent backup
  const latestBackup = backups[0]; // Already sorted by timestamp descending

  console.log(`🔄 Restoring ${getAppPreset(appName)?.displayName || appName}...`);
  console.log(`📁 Backup: ${latestBackup.backupPath}`);
  console.log(`🕐 Created: ${latestBackup.age}`);
  console.log(`🔧 Servers: ${latestBackup.serverCount}`);

  // Dry run
  if (options['dry-run']) {
    console.log('\n📋 Dry Run - would restore configuration.');
    return;
  }

  // Confirmation
  if (!options.yes) {
    const confirmed = await confirmRestore();
    if (!confirmed) {
      console.log('⏭️ Restore cancelled by user.');
      return;
    }
  }

  try {
    await rollbackFromBackupPath(latestBackup.backupPath);

    console.log(`✅ Successfully restored ${getAppPreset(appName)?.displayName || appName}`);
    console.log('🔄 Restart the application to use the restored configuration.');

    if (!options['keep-in-1mcp']) {
      console.log('\n💡 Note: Servers remain in 1mcp configuration.');
      console.log('   To remove them: npx @1mcp/agent server remove <server-name>');
    }
  } catch (error: any) {
    console.error(`❌ Restore failed: ${error.message}`);
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
