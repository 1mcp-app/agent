import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';

import { startOfficialReferenceServer } from './referenceServer.js';

describe('official reference fixture', () => {
  it('acknowledges a live catalog subscription through the selected SDK HTTP transport', async () => {
    const server = await startOfficialReferenceServer(process.cwd(), tmpdir());
    const client = new Client(
      { name: 'subscription-control-test', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: 'auto' } },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(server.endpoint)));
      expect(client.getProtocolEra()).toBe('modern');
      const changed = vi.fn();
      client.setNotificationHandler('notifications/tools/list_changed', changed);
      const subscription = await client.listen(
        { toolsListChanged: true, promptsListChanged: true },
        { timeout: 1_000 },
      );
      expect(subscription.honoredFilter).toEqual({ toolsListChanged: true, promptsListChanged: true });
      await client.callTool({ name: 'test_trigger_tool_change', arguments: {} });
      await expect.poll(() => changed.mock.calls.length).toBe(1);
      expect(changed.mock.calls[0][0]).toMatchObject({ method: 'notifications/tools/list_changed' });
      await subscription.close();
      await subscription.closed;
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('exposes canonical scenario names and schema-valid draft tool results, then closes its listener', async () => {
    const server = await startOfficialReferenceServer(process.cwd(), tmpdir());
    try {
      const rpc = async (method: string, params: Record<string, unknown> = {}) => {
        const response = await fetch(server.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2026-07-28',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params: {
              ...params,
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': { name: 'fixture-control-test', version: '1' },
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        });
        expect(response.ok).toBe(true);
        const text = await response.text();
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          const data = text.split('\n').find((line) => line.startsWith('data: '));
          return JSON.parse(data!.slice(6));
        }
        return JSON.parse(text);
      };
      const tools = await rpc('tools/list');
      expect(tools.result.tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'test_simple_text' })]),
      );
      expect((await rpc('resources/list')).result.resources.length).toBeGreaterThan(0);
      expect((await rpc('prompts/list')).result.prompts).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'test_simple_prompt' })]),
      );
      expect((await rpc('tools/call', { name: 'test_simple_text', arguments: {} })).result.resultType).toBe('complete');
      const invalid = await fetch(server.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2026-07-28' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'test_input_required_result_elicitation',
            inputResponses: { user_name: 123 },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'fixture-control-test', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).error.code).toBe(-32602);
    } finally {
      await server.close();
    }
    await expect(fetch(server.endpoint)).rejects.toThrow();
    await server.close();
  });

  it('rejects a modified fixture before launch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reference-integrity-'));
    try {
      const directory = join(root, 'test/conformance/official/fixtures/reference');
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'provenance.json'),
        await readFile('test/conformance/official/fixtures/reference/provenance.json'),
      );
      await writeFile(join(directory, 'everything-server.mjs'), '// tampered');
      await expect(startOfficialReferenceServer(root, tmpdir())).rejects.toThrow(
        'official-reference-integrity-invalid',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
