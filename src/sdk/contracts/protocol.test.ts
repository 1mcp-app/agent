import { toJsonValue, type JsonObject } from './jsonValue.js';
import {
  ErrorCode,
  hasHttpErrorCode,
  toProtocolJSONRPCMessage,
  toProtocolPrompt,
  toProtocolResource,
  toProtocolTool,
  type CallToolResult,
  type ClientCapabilities,
  type JSONRPCMessage,
  type ListToolsResult,
  type OAuthClientInformationFull,
  type Prompt,
  type PromptArgument,
  type Resource,
  type ResourceTemplate,
  type ServerCapabilities,
  type Tool,
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
    const callResult = { content: [{ type: 'text', text: 'done' }], structuredContent: { ok: true } } satisfies CallToolResult;
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
    expect(toProtocolPrompt(prompt)).toEqual(prompt);
    expect(toProtocolJSONRPCMessage(message)).toEqual(message);
    expect(() => toProtocolTool({ ...tool, description: 1 })).toThrow(TypeError);
    expect(() => toProtocolJSONRPCMessage({ jsonrpc: '2.0', id: 1 })).toThrow(TypeError);
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
