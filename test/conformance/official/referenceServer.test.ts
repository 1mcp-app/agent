import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyHttpTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CreateMessageRequestSchema, ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { describe, expect, it, vi } from 'vitest';

import { startOfficialReferenceServer } from './referenceServer.js';

describe('official reference fixture', () => {
  it('advertises a callable string header and applies public SDK decoding and validation before echoing', async () => {
    const server = await startOfficialReferenceServer(process.cwd(), tmpdir());
    const rpc = async (method: string, params: Record<string, unknown>, headers: Record<string, string> = {}) => {
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': method,
          ...(method === 'tools/call' ? { 'Mcp-Name': 'test_custom_header' } : {}),
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 22,
          method,
          params: {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'header-control-test', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      const text = await response.text();
      const data = text.startsWith('event:')
        ? text
            .split('\n')
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
        : text;
      return { status: response.status, body: JSON.parse(data ?? '') };
    };
    try {
      const catalog = await rpc('tools/list', {});
      expect(catalog.body.result.tools).toContainEqual(
        expect.objectContaining({
          name: 'test_custom_header',
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'string', 'x-mcp-header': 'Value' } },
            required: ['value'],
            additionalProperties: false,
          },
        }),
      );
      for (const [value, header] of [
        ['Hello', 'Hello'],
        ['Hello', '=?base64?SGVsbG8=?='],
        ['SGVsbG8=', 'SGVsbG8='],
        ['=?base64?SGVsbG8=', '=?base64?SGVsbG8='],
        ['你好', '=?base64?5L2g5aW9?='],
      ]) {
        const result = await rpc(
          'tools/call',
          { name: 'test_custom_header', arguments: { value } },
          {
            'Mcp-Param-Value': header,
          },
        );
        expect(result.status).toBe(200);
        expect(result.body.result).toMatchObject({ resultType: 'complete', content: [{ type: 'text', text: value }] });
      }
      const invalidHeaders: Record<string, string>[] = [
        { 'Mcp-Param-Value': 'different' },
        { 'Mcp-Param-Value': '=?base64?SGVsbG8?=' },
        { 'Mcp-Param-Value': '=?base64?SGVs!!!bG8=?=' },
        {},
      ];
      for (const headers of invalidHeaders) {
        const rejected = await rpc(
          'tools/call',
          { name: 'test_custom_header', arguments: { value: 'Hello' } },
          headers,
        );
        expect(rejected.status).toBe(400);
        expect(rejected.body).toMatchObject({ id: 22, error: { code: -32020 } });
        expect(rejected.body.result).toBeUndefined();
      }
    } finally {
      await server.close();
    }
  });

  it.each(['legacy', 'modern'])('fulfills real sampling and elicitation callbacks on the %s endpoint', async (era) => {
    const server = await startOfficialReferenceServer(process.cwd(), tmpdir());
    const sampling = vi.fn(async () => ({
      role: 'assistant' as const,
      model: 'callback-model',
      content: { type: 'text' as const, text: 'response from real handler' },
    }));
    const elicitation = vi.fn(async (request: unknown) => {
      expect(request).toMatchObject({
        params: {
          requestedSchema: {
            type: 'object',
            properties: { username: { type: 'string' }, email: { type: 'string' } },
            required: ['username', 'email'],
          },
        },
      });
      return {
        action: 'accept' as const,
        content: { username: 'response from real handler', email: 'callback@example.test' },
      };
    });
    const client =
      era === 'legacy'
        ? new LegacyClient(
            { name: 'callback-client', version: '1' },
            { capabilities: { sampling: {}, elicitation: {} } },
          )
        : new Client(
            { name: 'callback-client', version: '1' },
            { capabilities: { sampling: {}, elicitation: {} }, versionNegotiation: { mode: 'auto' } },
          );
    try {
      if (client instanceof LegacyClient) {
        client.setRequestHandler(CreateMessageRequestSchema, sampling);
        client.setRequestHandler(ElicitRequestSchema, elicitation);
        await client.connect(new LegacyHttpTransport(new URL(server.endpoint)));
      } else {
        client.setRequestHandler('sampling/createMessage', sampling);
        client.setRequestHandler('elicitation/create', elicitation);
        await client.connect(new StreamableHTTPClientTransport(new URL(server.endpoint)));
      }
      expect(await client.callTool({ name: 'test_sampling', arguments: { prompt: 'live prompt' } })).toMatchObject({
        content: [{ type: 'text', text: 'LLM response: response from real handler' }],
      });
      expect(sampling).toHaveBeenCalledTimes(1);
      expect(
        await client.callTool({ name: 'test_elicitation', arguments: { message: 'live question' } }),
      ).toMatchObject({ content: [{ type: 'text', text: expect.stringContaining('response from real handler') }] });
      expect(elicitation).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('uses actual legacy callback definitions in response-dependent native MRTR rounds', async () => {
    const server = await startOfficialReferenceServer(process.cwd(), tmpdir());
    const rpc = async (params: Record<string, unknown>) => {
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2026-07-28' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'callback-test', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': { sampling: {}, elicitation: {} },
            },
          },
        }),
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      for (const name of [
        'test_sampling',
        'test_elicitation',
        'test_elicitation_sep1034_defaults',
        'test_elicitation_sep1330_enums',
      ]) {
        const args = { prompt: 'unique upstream prompt', message: 'unique upstream question' };
        const first = await rpc({ name, arguments: args });
        expect(first.body.result.resultType).toBe('input_required');
        const callback = first.body.result.inputRequests.callback;
        if (name === 'test_sampling') {
          expect(callback.params.messages[0].content.text).toBe(args.prompt);
        } else {
          expect(callback.method).toBe('elicitation/create');
          expect(callback.params.mode).toBe('form');
          if (name.includes('defaults')) expect(callback.params.requestedSchema.properties.score.default).toBe(95.5);
          else if (name.includes('enums'))
            expect(callback.params.requestedSchema.properties.titledMulti.items.anyOf[0].title).toBe('First Choice');
          else {
            expect(callback.params.message).toBe(args.message);
            expect(callback.params.requestedSchema).toEqual({
              type: 'object',
              properties: {
                username: { type: 'string', description: "User's response" },
                email: { type: 'string', description: "User's email address" },
              },
              required: ['username', 'email'],
            });
          }
        }
        const response =
          name === 'test_sampling'
            ? { role: 'assistant', model: 'actual-test-model', content: { type: 'text', text: 'actual client answer' } }
            : {
                action: 'accept',
                content: { username: 'actual client answer', email: 'callback@example.test' },
              };
        const continuation = {
          name,
          arguments: args,
          requestState: first.body.result.requestState,
          inputResponses: { callback: response },
        };
        const complete = await rpc(continuation);
        expect(complete.status).toBe(200);
        expect(complete.body.result.resultType).toBe('complete');
        expect(complete.body.result.content[0].text).toContain('actual client answer');
        expect((await rpc({ ...continuation, arguments: { prompt: 'changed' } })).status).toBe(400);
        expect((await rpc({ ...continuation, requestState: 'forged' })).body.error.code).toBe(-32602);
        expect((await rpc({ ...continuation, inputResponses: { callback: 123 } })).status).toBe(400);
        if (name !== 'test_sampling') {
          for (const action of ['decline', 'cancel']) {
            expect(
              (await rpc({ ...continuation, inputResponses: { callback: { action } } })).body.result.content[0].text,
            ).toContain(`action=${action}`);
          }
        }
      }
    } finally {
      await server.close();
    }
  });

  it('streams valid progress and suppresses unrequested logs through the real modern SDK', async () => {
    const server = await startOfficialReferenceServer(process.cwd(), tmpdir());
    const client = new Client(
      { name: 'stream-test', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: 'auto' } },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(server.endpoint)));
      const progress = vi.fn();
      const logging = vi.fn();
      client.setNotificationHandler('notifications/message', logging);
      expect(
        await client.callTool({ name: 'test_streaming_elicitation', arguments: {} }, { onprogress: progress }),
      ).toMatchObject({ content: [expect.objectContaining({ type: 'text' })] });
      expect(progress).toHaveBeenCalledWith(expect.objectContaining({ progress: 50, total: 100 }));
      expect(await client.callTool({ name: 'test_logging_tool', arguments: {} })).toMatchObject({
        content: [expect.objectContaining({ type: 'text' })],
      });
      expect(logging).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('acknowledges only supported watched URIs and delivers updates on the owning listen stream', async () => {
    const server = await startOfficialReferenceServer(process.cwd(), tmpdir());
    const client = new Client(
      { name: 'watch-test', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: 'auto' } },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(server.endpoint)));
      expect(client.getServerCapabilities()?.resources?.subscribe).toBe(true);
      const updated = vi.fn();
      client.setNotificationHandler('notifications/resources/updated', updated);
      const subscription = await client.listen(
        { resourceSubscriptions: ['test://watched-resource', 'test://unknown'] },
        { timeout: 1_000 },
      );
      expect(subscription.honoredFilter).toEqual({ resourceSubscriptions: ['test://watched-resource'] });
      await expect.poll(() => updated.mock.calls.length, { timeout: 4_000 }).toBe(1);
      expect(updated.mock.calls[0][0]).toMatchObject({ params: { uri: 'test://watched-resource' } });
      expect((await client.readResource({ uri: 'test://watched-resource' })).contents[0]).toMatchObject({
        text: expect.stringContaining('revision 1'),
      });
      await subscription.close();
      await subscription.closed;
      const unsupported = await client.listen({ resourceSubscriptions: ['test://unknown'] }, { timeout: 1_000 });
      expect(unsupported.honoredFilter).toEqual({});
      await unsupported.close();
      await unsupported.closed;
    } finally {
      await client.close();
      await server.close();
    }
  }, 10_000);

  it.each(['tools', 'prompts'] as const)('advertises and executes the real %s catalog mutation hook', async (kind) => {
    const server = await startOfficialReferenceServer(process.cwd(), tmpdir());
    const client = new Client(
      { name: 'subscription-control-test', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: 'auto' } },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(server.endpoint)));
      expect(client.getProtocolEra()).toBe('modern');
      const catalog = await client.listTools();
      for (const name of ['test_trigger_tool_change', 'test_trigger_prompt_change']) {
        const matches = catalog.tools.filter((tool) => tool.name === name);
        expect(matches).toHaveLength(1);
        expect(matches[0].inputSchema).toEqual({ type: 'object', properties: {} });
      }
      const changed = vi.fn();
      const method = kind === 'tools' ? 'notifications/tools/list_changed' : 'notifications/prompts/list_changed';
      client.setNotificationHandler(method, changed);
      const subscription = await client.listen(
        { toolsListChanged: true, promptsListChanged: true },
        { timeout: 1_000 },
      );
      expect(subscription.honoredFilter).toEqual({ toolsListChanged: true, promptsListChanged: true });
      const hook = kind === 'tools' ? 'test_trigger_tool_change' : 'test_trigger_prompt_change';
      expect(await client.callTool({ name: hook, arguments: {} })).toMatchObject({
        content: [{ type: 'text', text: 'Mutation triggered' }],
      });
      await expect.poll(() => changed.mock.calls.length).toBe(1);
      expect(changed.mock.calls[0][0]).toMatchObject({ method });
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
