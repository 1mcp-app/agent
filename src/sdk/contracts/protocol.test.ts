import { type JsonObject, toJsonValue } from './jsonValue.js';
import {
  type CallToolResult,
  type ClientCapabilities,
  ErrorCode,
  hasHttpErrorCode,
  type JSONRPCMessage,
  type ListToolsResult,
  type OAuthClientInformationFull,
  type Prompt,
  type PromptArgument,
  type Resource,
  type ResourceTemplate,
  type ServerCapabilities,
  type Tool,
  toProtocolJSONRPCMessage,
  toProtocolPrompt,
  toProtocolResource,
  toProtocolResourceTemplate,
  toProtocolTool,
} from './protocol.js';

describe('plain protocol contracts', () => {
  it('keeps the stable error code values', () => {
    expect(ErrorCode).toMatchObject({
      ConnectionClosed: -32000,
      RequestTimeout: -32001,
      ParseError: -32700,
      InvalidRequest: -32600,
      MethodNotFound: -32601,
      InvalidParams: -32602,
      InternalError: -32603,
      UrlElicitationRequired: -32042,
    });
  });

  it('recognizes HTTP error facts without relying on class identity', () => {
    expect(hasHttpErrorCode({ code: 404 }, 404)).toBe(true);
    expect(hasHttpErrorCode({ code: '404' }, 404)).toBe(false);
    expect(hasHttpErrorCode(new Error('not found'), 404)).toBe(false);
  });

  it('keeps representative protocol payloads JSON-safe', () => {
    const tool = { name: 'search', inputSchema: { type: 'object', properties: {} } } satisfies Tool;
    const promptArgument = { name: 'topic', required: true } satisfies PromptArgument;
    const prompt = { name: 'explain', arguments: [promptArgument] } satisfies Prompt;
    const resource = { name: 'guide', uri: 'file:///guide.md', mimeType: 'text/markdown' } satisfies Resource;
    const resourceTemplate = { name: 'guides', uriTemplate: 'file:///{name}.md' } satisfies ResourceTemplate;
    const callResult = {
      content: [{ type: 'text', text: 'done' }],
      structuredContent: { ok: true },
    } satisfies CallToolResult;
    const listResult = { tools: [tool], nextCursor: 'next' } satisfies ListToolsResult;
    const clientCapabilities = { roots: { listChanged: true } } satisfies ClientCapabilities;
    const serverCapabilities = { tools: { listChanged: true } } satisfies ServerCapabilities;
    const message = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'contracts' } },
    } satisfies JSONRPCMessage;
    const oauthClient = {
      client_id: 'client',
      redirect_uris: ['https://client.example/callback'],
      jwks: { keys: [] },
    } satisfies OAuthClientInformationFull;

    const payloads: JsonObject[] = [
      tool,
      promptArgument,
      prompt,
      resource,
      resourceTemplate,
      callResult,
      listResult,
      clientCapabilities,
      serverCapabilities,
      message,
      oauthClient,
    ];
    expect(payloads.map((payload) => toJsonValue(payload))).toEqual(payloads);
    expect(toProtocolTool(tool)).toEqual(tool);
    expect(toProtocolResource(resource)).toEqual(resource);
    expect(toProtocolResourceTemplate(resourceTemplate)).toEqual(resourceTemplate);
    expect(toProtocolPrompt(prompt)).toEqual(prompt);
    expect(toProtocolJSONRPCMessage(message)).toEqual(message);
    expect(() => toProtocolTool({ ...tool, description: 1 })).toThrow(TypeError);
    expect(() => toProtocolJSONRPCMessage({ jsonrpc: '2.0', id: 1 })).toThrow(TypeError);
  });

  const metadata = {
    name: 'source',
    title: 'Source title',
    description: 'Source description',
    icons: [{ src: 'https://example.com/icon.png', mimeType: 'image/png', sizes: ['48x48'], theme: 'dark' }],
    _meta: { 'example.com/data': { nested: [null, true, 42, { value: 'opaque' }] } },
    'example.com/future': { enabled: false },
  };

  it.each([
    [
      'tool',
      toProtocolTool,
      {
        ...metadata,
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', 'x-future': [1, 2] } },
          required: ['query'],
        },
        outputSchema: { type: 'object', properties: {} },
        execution: { taskSupport: 'optional', future: true },
        annotations: {
          title: 'Hints',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
          future: [],
        },
      },
    ],
    ['prompt', toProtocolPrompt, { ...metadata, arguments: [{ ...metadata, required: true, extra: [1] }] }],
    [
      'resource',
      toProtocolResource,
      {
        ...metadata,
        uri: 'file:///source',
        mimeType: 'text/plain',
        size: 3,
        annotations: {
          audience: ['user', 'assistant'],
          priority: 0.5,
          lastModified: '2026-09-08T00:00:00Z',
          extra: [1],
        },
      },
    ],
    [
      'resourceTemplate',
      toProtocolResourceTemplate,
      {
        ...metadata,
        uriTemplate: 'file:///{name}',
        mimeType: 'text/plain',
        annotations: { audience: ['user'], priority: 1, lastModified: '2026-09-08T00:00:00Z', extra: [1] },
      },
    ],
  ] as const)('round-trips every defined %s field and opaque JSON without sharing values', (_kind, convert, source) => {
    const result = convert(source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(result._meta).not.toBe(source._meta);
    expect(result.icons).not.toBe(source.icons);
    expect(convert(JSON.parse(JSON.stringify(result)))).toEqual(result);
    result._meta!['example.com/data'] = null;
    expect(source._meta['example.com/data']).toEqual({ nested: [null, true, 42, { value: 'opaque' }] });
  });

  it.each([
    { name: 'bad' },
    { name: 'bad', uriTemplate: 1 },
    { name: 'bad', uriTemplate: 'file:///{id}', annotations: { audience: ['unknown'] } },
    { name: 'bad', uriTemplate: 'file:///{id}', _meta: [] },
  ])('rejects an invalid resource template %j', (source) => {
    expect(() => toProtocolResourceTemplate(source)).toThrow(TypeError);
  });

  it.each([
    { jsonrpc: '2.0', id: 1.5, method: 'ping' },
    { jsonrpc: '2.0', id: 1, method: 'ping', result: {} },
    { jsonrpc: '2.0', id: 1, result: {}, error: { code: -32_603, message: 'ambiguous' } },
    { jsonrpc: '2.0', id: 1, error: { code: -32_603.5, message: 'fractional' } },
  ])('rejects ambiguous or fractional JSON-RPC shapes', (message) => {
    expect(() => toProtocolJSONRPCMessage(message)).toThrow(TypeError);
  });
});
