import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock os module to control home directory
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(),
    tmpdir: vi.fn(() => '/tmp'),
  },
  tmpdir: vi.fn(() => '/tmp'),
}));
import { createBackup, listAppBackups, rollbackFromBackupPath, findBackupByMetaPath } from './backupManager.js';
import { getAppBackupDir } from '@src/constants.js';

describe('backupManager', () => {
  let tempDir: string;
  let testConfigPath: string;
  let mockHomedir: any;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join('/tmp', 'backup-test-'));
    testConfigPath = path.join(tempDir, 'test-config.json');

    // Mock os.homedir to return our temp directory
    mockHomedir = vi.mocked(os.homedir);
    mockHomedir.mockReturnValue(tempDir);

    // Create a test config file
    const testConfig = { mcpServers: { 'test-server': { command: 'node', args: ['test.js'] } } };
    fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
  });

  afterEach(() => {
    // Restore mocks
    vi.restoreAllMocks();

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('createBackup', () => {
    it('should create backup in centralized directory with proper structure', () => {
      const appName = 'test-app';
      const operation = 'consolidate';
      const serverCount = 2;

      const backup = createBackup(testConfigPath, appName, operation, serverCount);

      // Check that backup was created in the right location
      const expectedBackupDir = getAppBackupDir(appName);
      expect(backup.backupPath.startsWith(expectedBackupDir)).toBe(true);

      // Check that backup file exists
      expect(fs.existsSync(backup.backupPath)).toBe(true);

      // Check that metadata file exists
      const metaPath = `${backup.backupPath}.meta`;
      expect(fs.existsSync(metaPath)).toBe(true);

      // Check backup filename format
      const fileName = path.basename(backup.backupPath);
      expect(fileName).toMatch(/^\d{8}T\d{6}_consolidate\.backup$/);

      // Check metadata content
      const metaContent = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      expect(metaContent.originalPath).toBe(testConfigPath);
      expect(metaContent.metadata.app).toBe(appName);
      expect(metaContent.metadata.operation).toBe(operation);
      expect(metaContent.metadata.serverCount).toBe(serverCount);
    });

    it('should create app directory if it does not exist', () => {
      const appName = 'new-app';
      const appBackupDir = getAppBackupDir(appName);

      // Ensure directory doesn't exist
      expect(fs.existsSync(appBackupDir)).toBe(false);

      createBackup(testConfigPath, appName, 'test', 1);

      // Directory should now exist
      expect(fs.existsSync(appBackupDir)).toBe(true);
    });
  });

  describe('listAppBackups', () => {
    it('should find backups in centralized directory', () => {
      const appName = 'test-app';

      // Create a backup
      createBackup(testConfigPath, appName, 'consolidate', 2);

      // List backups
      const backups = listAppBackups(appName);

      expect(backups).toHaveLength(1);
      expect(backups[0].app).toBe(appName);
      expect(backups[0].operation).toBe('consolidate');
      expect(backups[0].serverCount).toBe(2);
    });

    it('should list all app backups when no app specified', () => {
      // Create backups for different apps
      createBackup(testConfigPath, 'app1', 'consolidate', 1);
      createBackup(testConfigPath, 'app2', 'consolidate', 2);

      const backups = listAppBackups();

      expect(backups).toHaveLength(2);
      expect(backups.map((b) => b.app).sort()).toEqual(['app1', 'app2']);
    });
  });

  describe('rollbackFromBackupPath', () => {
    it('should restore original file from backup', async () => {
      const appName = 'test-app';

      // Create backup
      const backup = createBackup(testConfigPath, appName, 'consolidate', 1);

      // Modify original file
      const modifiedConfig = { mcpServers: { modified: true } };
      fs.writeFileSync(testConfigPath, JSON.stringify(modifiedConfig));

      // Restore from backup
      await rollbackFromBackupPath(backup.backupPath);

      // Check that original content is restored
      const restoredContent = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
      expect(restoredContent.mcpServers['test-server']).toBeDefined();
      expect(restoredContent.mcpServers.modified).toBeUndefined();
    });
  });

  describe('findBackupByMetaPath', () => {
    it('should find backup info by metadata path', () => {
      const appName = 'test-app';
      const backup = createBackup(testConfigPath, appName, 'consolidate', 1);
      const metaPath = `${backup.backupPath}.meta`;

      const foundBackup = findBackupByMetaPath(metaPath);

      expect(foundBackup).not.toBeNull();
      expect(foundBackup?.originalPath).toBe(testConfigPath);
      expect(foundBackup?.metadata.app).toBe(appName);
    });

    it('should return null for non-existent metadata path', () => {
      const nonExistentPath = path.join(tempDir, 'non-existent.meta');
      const foundBackup = findBackupByMetaPath(nonExistentPath);

      expect(foundBackup).toBeNull();
    });
  });
});
