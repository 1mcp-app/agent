import { vi } from 'vitest';

vi.mock('@src/domains/server-management/serverInstallationService.js', () => ({
  createServerInstallationService: () => ({
    installServer: vi.fn().mockResolvedValue({
      success: true,
      status: 'applied',
      serverName: 'test-server',
      version: '1.0.0',
      installedAt: new Date(),
      configPath: '/path/to/config',
      backupPath: '/path/to/backup',
      warnings: [],
      errors: [],
      operationId: 'test-op-id',
    }),
    uninstallServer: vi.fn().mockResolvedValue({
      success: true,
      serverName: 'test-server',
      removedAt: new Date(),
      configRemoved: true,
      warnings: [],
      errors: [],
      operationId: 'test-op-id',
    }),
    updateServer: vi.fn().mockResolvedValue({
      success: true,
      serverName: 'test-server',
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      updatedAt: new Date(),
      warnings: [],
      errors: [],
      operationId: 'test-op-id',
    }),
    listInstalledServers: vi.fn().mockResolvedValue(['server1', 'server2']),
    checkForUpdates: vi.fn().mockResolvedValue([
      {
        serverName: 'test-server',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        hasUpdate: true,
        updateAvailable: true,
        updateType: 'minor' as const,
      },
    ]),
  }),
}));

vi.mock('@src/domains/discovery/appDiscovery.js', () => ({
  checkConsolidationStatus: vi.fn(),
  discoverAppConfigs: vi.fn(),
  discoverInstalledApps: vi.fn().mockResolvedValue({
    configurable: [
      {
        name: 'vscode',
        displayName: 'Visual Studio Code',
        hasConfig: true,
        configCount: 2,
        serverCount: 1,
        paths: ['/path/to/config'],
      },
    ],
    manualOnly: ['sublime'],
  }),
  extractAndFilterServers: vi.fn(),
}));
