import {
  listAppBackups,
  cleanupOldBackups,
  verifyBackupIntegrity,
  findBackupByMetaPath,
} from '../../utils/backupManager.js';
import { getAppPreset } from '../../utils/appPresets.js';
import { GlobalOptions } from '../../globalOptions.js';

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
 * Main backups command handler
 */
export async function backupsCommand(options: BackupsOptions): Promise<void> {
  console.log('💾 MCP Configuration Backup Management\n');

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
      console.log(`📭 No backups found for ${appName}.`);
    } else {
      console.log('📭 No backups found.');
    }
    console.log('\n💡 Backups are created automatically during consolidation.');
    return;
  }

  if (appName) {
    const preset = getAppPreset(appName);
    console.log(`📋 Backups for ${preset?.displayName || appName}:\n`);
  } else {
    console.log('📋 All Available Backups:\n');
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
    console.log(`📱 ${preset?.displayName || app} (${app}):`);

    for (const backup of appBackups) {
      const backupInfo = findBackupByMetaPath(backup.metaPath);

      console.log(`   🕐 ${backup.age} - ${backup.operation} operation`);
      console.log(`      📁 ${backup.backupPath}`);
      console.log(`      🔧 ${backup.serverCount} servers backed up`);

      if (backupInfo) {
        const fileSizeKB = Math.round(backupInfo.metadata.fileSize / 1024);
        totalSize += backupInfo.metadata.fileSize;
        console.log(`      📊 Size: ${fileSizeKB} KB`);

        // Verify integrity if requested
        if (verify) {
          const isValid = verifyBackupIntegrity(backupInfo);
          if (isValid) {
            console.log(`      ✅ Integrity: Valid`);
            verifiedCount++;
          } else {
            console.log(`      ❌ Integrity: Corrupted`);
            corruptedCount++;
          }
        }
      }

      console.log(`      📝 Metadata: ${backup.metaPath}`);
      console.log();
    }
  }

  // Summary
  const totalSizeMB = Math.round((totalSize / (1024 * 1024)) * 100) / 100;
  console.log('📊 Backup Summary:');
  console.log(`   📦 Total backups: ${backups.length}`);
  console.log(`   📱 Applications: ${Object.keys(groupedBackups).length}`);
  console.log(`   💽 Total size: ${totalSizeMB} MB`);

  if (verify) {
    console.log(`   ✅ Verified: ${verifiedCount}`);
    if (corruptedCount > 0) {
      console.log(`   ❌ Corrupted: ${corruptedCount}`);
    }
  }

  // Show oldest and newest
  if (backups.length > 1) {
    const oldest = backups[backups.length - 1];
    const newest = backups[0];
    console.log(`   🕐 Oldest: ${oldest.age} (${getAppPreset(oldest.app)?.displayName || oldest.app})`);
    console.log(`   🕐 Newest: ${newest.age} (${getAppPreset(newest.app)?.displayName || newest.app})`);
  }

  // Usage recommendations
  console.log('\n💡 Management Commands:');
  console.log('   📋 List app backups: npx @1mcp/agent app backups <app-name>');
  console.log('   🔍 Verify integrity: npx @1mcp/agent app backups --verify');
  console.log('   🧹 Cleanup old: npx @1mcp/agent app backups --cleanup=30');
  console.log('   🔄 Restore: npx @1mcp/agent app restore <app-name>');

  if (corruptedCount > 0) {
    console.log('\n⚠️ Warning: Some backups failed integrity verification.');
    console.log('   Consider creating fresh backups for affected applications.');
  }
}

/**
 * Cleanup old backups
 */
async function cleanupBackups(maxAgeDays: number): Promise<void> {
  console.log(`🧹 Cleaning up backups older than ${maxAgeDays} days...\n`);

  if (maxAgeDays < 1) {
    console.error('❌ Invalid age: must be at least 1 day.');
    process.exit(1);
  }

  // Show what will be deleted first
  const allBackups = listAppBackups();
  const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const oldBackups = allBackups.filter((backup) => backup.timestamp < cutoffTime);

  if (oldBackups.length === 0) {
    console.log(`✅ No backups older than ${maxAgeDays} days found.`);
    return;
  }

  console.log(`📋 Found ${oldBackups.length} backups to delete:\n`);

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
    console.log(`📱 ${preset?.displayName || app}: ${appBackups.length} backups`);
    appBackups.forEach((backup) => {
      console.log(`   🕐 ${backup.age} - ${backup.operation}`);
    });
  });

  // Perform cleanup
  console.log('\n🗑️ Deleting old backups...');
  const deletedCount = cleanupOldBackups(maxAgeDays);

  if (deletedCount > 0) {
    console.log(`✅ Successfully deleted ${deletedCount} old backups.`);

    // Show remaining backups
    const remainingBackups = listAppBackups();
    console.log(`📦 Remaining backups: ${remainingBackups.length}`);

    if (remainingBackups.length > 0) {
      const totalSize = remainingBackups.reduce((sum, backup) => {
        const backupInfo = findBackupByMetaPath(backup.metaPath);
        return sum + (backupInfo?.metadata.fileSize || 0);
      }, 0);
      const totalSizeMB = Math.round((totalSize / (1024 * 1024)) * 100) / 100;
      console.log(`💽 Total size: ${totalSizeMB} MB`);
    }
  } else {
    console.log('⚠️ No backups were deleted (they may have been removed already).');
  }

  console.log('\n💡 To see remaining backups: npx @1mcp/agent app backups');
}
