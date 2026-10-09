import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { buildPublicResourceUri } from '@src/utils/core/resourceUris.js';

import { describe, expect, it, vi } from 'vitest';

import { startDisabledStaticRemote } from './fixtures/disabledStaticRemote.js';

interface Identity {
  pid: number;
  revision: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

describe('Disabled Static Server real stdio lifecycle', () => {
  it.each([true, false])(
    'withdraws capabilities, closes the owned child and restores the latest definition (notifications: %s)',
    async (notificationsEnabled) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-disabled-static-'));
      const configPath = path.join(directory, 'mcp.json');
      const fixture = path.resolve('test/e2e/fixtures/disabled-static-server.mjs');
      const definition = (revision: string, disabled = false) => ({
        type: 'stdio',
        command: process.execPath,
        args: [fixture, revision],
        disabled,
      });
      const config = {
        mcpServers: {
          target: definition('original'),
          unaffected: definition('unaffected'),
          initial: definition('initial', true),
          // Retain this definition last so its MODIFIED lifecycle marker follows the disabled edits.
          reloadWitness: definition('disabled-edit-applied', true),
        },
      };
      const save = () => fs.writeFileSync(configPath, JSON.stringify(config));
      save();
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key, value]) => !key.startsWith('ONE_MCP_') && value !== undefined),
      ) as Record<string, string>;
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          path.resolve('build/index.js'),
          'serve',
          '--transport',
          'stdio',
          '--config-dir',
          directory,
          '--enable-async-loading',
          `--enable-client-notifications=${notificationsEnabled}`,
          '--log-level',
          'error',
        ],
        env,
        stderr: 'pipe',
      });
      const client = new Client({ name: 'disabled-static-lifecycle', version: '1' });
      const notes: string[] = [];
      for (const schema of [
        ToolListChangedNotificationSchema,
        ResourceListChangedNotificationSchema,
        PromptListChangedNotificationSchema,
      ]) {
        client.setNotificationHandler(schema, (notification) => {
          notes.push(notification.method);
        });
      }
      let stderr = '';
      transport.stderr?.on('data', (chunk) => (stderr += String(chunk)));
      const identity = async (name: string): Promise<Identity> => {
        const result = await client.callTool({ name, arguments: {} });
        const content = result.content as Array<{ type: string; text: string }>;
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        return JSON.parse(content[0].text) as Identity;
      };
      try {
        await client.connect(transport);
        await vi.waitFor(
          async () => {
            expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(
              expect.arrayContaining(['target_1mcp_identity', 'unaffected_1mcp_identity']),
            );
          },
          { timeout: 15000, interval: 100 },
        );
        const runtimePid = transport.pid;
        const original = await identity('target_1mcp_identity');
        const unaffected = await identity('unaffected_1mcp_identity');
        const resource = (await client.listResources()).resources.find(
          ({ uri }) => uri === buildPublicResourceUri('target', 'fixture:///identity'),
        );
        const prompt = (await client.listPrompts()).prompts.find(({ name }) => name === 'target_1mcp_identity');
        expect(resource).toBeDefined();
        expect(prompt).toBeDefined();
        expect((await client.listTools()).tools.some(({ name }) => name.startsWith('initial_'))).toBe(false);
        notes.length = 0;

        // One save changes both disable intent and launch arguments. It must unload, not launch the edit.
        config.mcpServers.target = definition('disabled-edit', true);
        save();
        await vi.waitFor(() => expect(alive(original.pid), stderr).toBe(false), { timeout: 12000, interval: 100 });
        await vi.waitFor(
          async () => {
            expect((await client.listTools()).tools.some(({ name }) => name.startsWith('target_'))).toBe(false);
            expect((await client.listResources()).resources.some(({ uri }) => uri === resource!.uri)).toBe(false);
            expect((await client.listPrompts()).prompts.some(({ name }) => name === prompt!.name)).toBe(false);
          },
          { timeout: 5000, interval: 100 },
        );
        await expect(client.callTool({ name: 'target_1mcp_identity', arguments: {} })).rejects.toThrow();
        await expect(client.readResource({ uri: resource!.uri })).rejects.toThrow();
        await expect(client.getPrompt({ name: prompt!.name })).rejects.toThrow();
        expect(await identity('unaffected_1mcp_identity')).toEqual(unaffected);
        expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.target).toEqual(
          definition('disabled-edit', true),
        );
        if (notificationsEnabled) {
          await vi.waitFor(() =>
            expect(notes).toEqual(
              expect.arrayContaining([
                'notifications/tools/list_changed',
                'notifications/resources/list_changed',
                'notifications/prompts/list_changed',
              ]),
            ),
          );
        } else {
          expect(notes).toEqual([]);
        }

        config.mcpServers.target = definition('latest', true);
        config.mcpServers.initial = definition('initial-edit', true);
        config.mcpServers.reloadWitness.disabled = false;
        save();
        // This backend can become callable only after the lifecycle handler applies this save.
        await vi.waitFor(
          async () => expect((await identity('reloadWitness_1mcp_identity')).revision).toBe('disabled-edit-applied'),
          { timeout: 15000, interval: 100 },
        );
        expect((await client.listTools()).tools.some(({ name }) => /^(target|initial)_/.test(name))).toBe(false);
        config.mcpServers.target.disabled = false;
        save();
        await vi.waitFor(async () => expect((await identity('target_1mcp_identity')).revision).toBe('latest'), {
          timeout: 15000,
          interval: 100,
        });
        expect((await identity('target_1mcp_identity')).pid).not.toBe(original.pid);
        expect((await client.listResources()).resources).toContainEqual(
          expect.objectContaining({ uri: resource!.uri }),
        );
        expect((await client.listPrompts()).prompts).toContainEqual(expect.objectContaining({ name: prompt!.name }));
        expect(await identity('unaffected_1mcp_identity')).toEqual(unaffected);
        expect(transport.pid).toBe(runtimePid);
        if (!notificationsEnabled) expect(notes).toEqual([]);
      } finally {
        await client.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

describe('Disabled Static Server remote connection lifecycle', () => {
  it.each(['http', 'sse'] as const)(
    'disconnects %s while preserving the independently hosted backend',
    async (type) => {
      const backend = await startDisabledStaticRemote(type);
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-disabled-remote-'));
      const configPath = path.join(directory, 'mcp.json');
      const config = { mcpServers: { remote: { type, url: backend.url, disabled: false } } };
      const save = () => fs.writeFileSync(configPath, JSON.stringify(config));
      save();
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key, value]) => !key.startsWith('ONE_MCP_') && value !== undefined),
      ) as Record<string, string>;
      const client = new Client({ name: 'disabled-remote-lifecycle', version: '1' });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          path.resolve('build/index.js'),
          'serve',
          '-t',
          'stdio',
          '--config-dir',
          directory,
          '--log-level',
          'error',
        ],
        env,
        stderr: 'pipe',
      });
      try {
        await client.connect(transport);
        expect((await client.listTools()).tools).toContainEqual(
          expect.objectContaining({ name: 'remote_1mcp_identity' }),
        );
        await vi.waitFor(() => expect(backend.activeStreams()).toBe(1));
        config.mcpServers.remote.disabled = true;
        save();
        await vi.waitFor(() => expect(backend.activeStreams()).toBe(0), { timeout: 12000, interval: 100 });
        expect((await client.listTools()).tools.some(({ name }) => name.startsWith('remote_'))).toBe(false);
        await expect(client.callTool({ name: 'remote_1mcp_identity', arguments: {} })).rejects.toThrow();
        expect(await (await fetch(backend.health)).text()).toBe('alive');
        config.mcpServers.remote.disabled = false;
        save();
        await vi.waitFor(
          async () =>
            expect((await client.listTools()).tools).toContainEqual(
              expect.objectContaining({ name: 'remote_1mcp_identity' }),
            ),
          { timeout: 12000, interval: 100 },
        );
        expect(await client.callTool({ name: 'remote_1mcp_identity', arguments: {} })).toMatchObject({
          content: [{ type: 'text', text: 'remote-alive' }],
        });
      } finally {
        await client.close();
        await backend.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
