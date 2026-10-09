import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ConfigContext from '@src/config/configContext.js';
import { CONFIG_EVENTS, ConfigChangeType, ConfigManager } from '@src/config/configManager.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { ConfigChangeHandler } from '@src/core/configChangeHandler.js';
import type { MCPServerParams } from '@src/core/types/transport.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  loadMcpServer: vi.fn().mockResolvedValue(undefined),
  unloadMcpServer: vi.fn().mockResolvedValue(undefined),
  getClients: () => new Map(),
  getInstructionAggregator: () => undefined,
  getInboundConnections: () => new Map([['client', {}]]),
  notificationsEnabled: true,
  notify: vi.fn(),
}));

vi.mock('@src/core/server/serverManager.js', () => ({ ServerManager: { current: runtime } }));
vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: () => ({
      get: (key: string) => {
        if (key === 'features') {
          return { configReload: true, envSubstitution: false, clientNotifications: runtime.notificationsEnabled };
        }
        if (key === 'configReload') return { debounceMs: 100 };
        return {};
      },
    }),
  },
}));
vi.mock('@src/core/capabilities/capabilityAggregator.js', () => ({
  CapabilityAggregator: class {
    async updateCapabilities() {
      return {
        hasChanges: true,
        toolsChanged: true,
        resourcesChanged: true,
        promptsChanged: true,
        resourceTemplatesChanged: false,
        addedServers: [],
        removedServers: ['backend'],
        current: { tools: [], resources: [], prompts: [] },
        previous: {},
      };
    }
  },
}));
vi.mock('@src/core/notifications/notificationManager.js', () => ({
  NotificationManager: class {
    handleCapabilityChanges = runtime.notify;
  },
}));

describe('Disabled Static Server validated reload handoff', () => {
  let directory: string;
  let configPath: string;
  let manager: ConfigManager;
  let handler: ConfigChangeHandler;
  let reloadApplied: Promise<void>;
  const backend: MCPServerParams = { type: 'stdio', command: 'node', args: ['original.js'] };
  const unaffected: MCPServerParams = { type: 'stdio', command: 'node', args: ['unaffected.js'] };

  /** Persist server definitions through the public configuration boundary. */
  async function save(servers: Record<string, MCPServerParams>) {
    await writeFile(configPath, JSON.stringify({ mcpServers: servers }));
  }

  /** Apply a saved configuration and wait for its reload handoff to finish. */
  async function reload(servers: Record<string, MCPServerParams>) {
    await save(servers);
    await manager.reloadConfig();
    await reloadApplied;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    runtime.notificationsEnabled = true;
    directory = await mkdtemp(join(tmpdir(), 'disabled-static-reload-'));
    configPath = join(directory, 'mcp.json');
    ConfigContext.getInstance().setConfigPath(configPath);
    Reflect.set(ConfigManager, 'instance', undefined);
    Reflect.set(McpConfigManager, 'instance', undefined);
    Reflect.set(ConfigChangeHandler, 'instance', undefined);
    await save({ backend, unaffected });
    manager = ConfigManager.getInstance(configPath);
    await manager.initialize();
    await manager.stop();
    handler = ConfigChangeHandler.getInstance(manager);
    const listener = manager.listeners(CONFIG_EVENTS.CONFIG_CHANGED)[0];
    manager.removeListener(CONFIG_EVENTS.CONFIG_CHANGED, listener);
    manager.on(CONFIG_EVENTS.CONFIG_CHANGED, (changes) => {
      // Preserve the real emitted-event handoff while awaiting its asynchronous application.
      reloadApplied = Promise.resolve(listener(changes));
    });
  });

  afterEach(async () => {
    await handler?.stop();
    await manager?.stop();
    ConfigContext.getInstance().reset();
    await rm(directory, { recursive: true, force: true });
  });

  it('detects and unloads a retained disabled definition despite enabled-only transport filtering', async () => {
    const changes = vi.fn();
    manager.on(CONFIG_EVENTS.CONFIG_CHANGED, changes);
    await reload({ backend: { ...backend, disabled: true }, unaffected });
    expect(changes).toHaveBeenCalledWith([
      { serverName: 'backend', type: ConfigChangeType.MODIFIED, fieldsChanged: ['disabled'] },
    ]);
    expect(manager.getTransportConfig()).toEqual({ unaffected });
    expect(manager.loadDeclaredServerConfigs().staticServers).toMatchObject({ backend: { disabled: true } });
    expect(runtime.unloadMcpServer).toHaveBeenCalledWith('backend');
    expect(runtime.loadMcpServer).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(runtime.notify).toHaveBeenCalledWith(
        expect.objectContaining({ toolsChanged: true, resourcesChanged: true, promptsChanged: true }),
      ),
    );
  });

  it.each([
    { type: 'http' as const, url: 'https://example.test/mcp' },
    { type: 'sse' as const, url: 'https://example.test/sse' },
  ])('disconnects a retained disabled $type target through the existing unload lifecycle', async (remote) => {
    await reload({ backend: remote, unaffected });
    vi.clearAllMocks();
    await reload({ backend: { ...remote, disabled: true }, unaffected });
    expect(runtime.unloadMcpServer).toHaveBeenCalledWith('backend');
    expect(runtime.loadMcpServer).not.toHaveBeenCalled();
    expect(manager.getTransportConfig()).toEqual({ unaffected });
  });

  it('unloads combined disable and functional edits, then re-enables using the latest validated definition', async () => {
    const latest = { ...backend, args: ['latest.js'], disabled: true };
    await reload({ backend: latest, unaffected });
    expect(runtime.unloadMcpServer).toHaveBeenCalledWith('backend');
    expect(runtime.loadMcpServer).not.toHaveBeenCalled();
    vi.clearAllMocks();
    await reload({ backend: { ...latest, args: ['still-disabled.js'] }, unaffected });
    expect(runtime.loadMcpServer).not.toHaveBeenCalled();
    vi.clearAllMocks();
    const enabled = { ...latest, args: ['still-disabled.js'], disabled: false };
    await reload({ backend: enabled, unaffected });
    expect(runtime.loadMcpServer).toHaveBeenCalledWith('backend', enabled);
    expect(runtime.unloadMcpServer).not.toHaveBeenCalled();
    expect(manager.getTransportConfig()).toEqual({ backend: enabled, unaffected });
  });

  it('keeps notifications suppressed when the existing feature is disabled', async () => {
    runtime.notificationsEnabled = false;
    await reload({ backend: { ...backend, disabled: true }, unaffected });
    expect(runtime.unloadMcpServer).toHaveBeenCalledWith('backend');
    expect(runtime.notify).not.toHaveBeenCalled();
  });

  it('rejects invalid disable intent without unloading the validated running definition', async () => {
    await writeFile(configPath, '{"mcpServers":{"backend":{"disabled":true');
    await expect(manager.reloadConfig()).rejects.toThrow();
    expect(manager.getTransportConfig()).toEqual({ backend, unaffected });
    expect(runtime.unloadMcpServer).not.toHaveBeenCalled();
    expect(runtime.loadMcpServer).not.toHaveBeenCalled();
    expect(runtime.notify).not.toHaveBeenCalled();
  });

  it('does not treat a disabled changed-field hint as authoritative intent for a missing definition', async () => {
    manager.emit(CONFIG_EVENTS.CONFIG_CHANGED, [
      { serverName: 'missing', type: ConfigChangeType.MODIFIED, fieldsChanged: ['disabled'] },
    ]);
    await reloadApplied;
    expect(runtime.unloadMcpServer).not.toHaveBeenCalled();
    expect(runtime.loadMcpServer).not.toHaveBeenCalled();
    expect(runtime.notify).not.toHaveBeenCalled();
  });

  it('continues to unload removed definitions without changing unaffected servers', async () => {
    await reload({ unaffected });
    expect(runtime.unloadMcpServer).toHaveBeenCalledWith('backend');
    expect(runtime.loadMcpServer).not.toHaveBeenCalled();
    expect(manager.getTransportConfig()).toEqual({ unaffected });
  });

  it('keeps an initially disabled definition out of startup selection and does not launch it after edits', async () => {
    await save({ backend: { ...backend, disabled: true }, unaffected });
    await manager.initialize();
    await manager.stop();
    expect(manager.getTransportConfig()).toEqual({ unaffected });
    expect(runtime.loadMcpServer).not.toHaveBeenCalled();
    await reload({ backend: { ...backend, disabled: true, args: ['edited-disabled.js'] }, unaffected });
    expect(runtime.loadMcpServer).not.toHaveBeenCalled();
    expect(manager.getTransportConfig()).toEqual({ unaffected });
    expect(manager.loadDeclaredServerConfigs().staticServers.backend).toMatchObject({
      disabled: true,
      args: ['edited-disabled.js'],
    });
  });
});
