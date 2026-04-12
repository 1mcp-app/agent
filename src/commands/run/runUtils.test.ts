import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { describe, expect, it } from 'vitest';

import { formatToolCallOutput, parseToolReference, resolveToolArguments, RunCommandInputError } from './runUtils.js';

function createTool(inputSchema: Record<string, unknown>): Tool {
  return {
    name: 'summarizer_1mcp_summarize',
    description: 'Summarize text',
    inputSchema: inputSchema as Tool['inputSchema'],
  };
}

describe('parseToolReference', () => {
  it('parses server and tool names', () => {
    expect(parseToolReference('filesystem/read_file')).toEqual({
      serverName: 'filesystem',
      toolName: 'read_file',
      qualifiedName: 'filesystem_1mcp_read_file',
    });
  });

  it('rejects invalid tool references', () => {
    expect(() => parseToolReference('filesystem')).toThrow(RunCommandInputError);
    expect(() => parseToolReference('/read_file')).toThrow(RunCommandInputError);
  });
});

describe('resolveToolArguments', () => {
  it('prefers explicit --args over stdin', () => {
    const result = resolveToolArguments({
      explicitArgs: '{"text":"from-args"}',
      stdinText: 'from-stdin',
    });

    expect(result).toEqual({
      arguments: { text: 'from-args' },
      usedStdin: false,
    });
  });

  it('uses stdin json objects directly', () => {
    const result = resolveToolArguments({
      stdinText: '{"text":"hello","maxTokens":20}',
    });

    expect(result).toEqual({
      arguments: { text: 'hello', maxTokens: 20 },
      usedStdin: true,
    });
  });

  it('maps raw stdin to the first required string property', () => {
    const result = resolveToolArguments({
      stdinText: 'hello world',
      tool: createTool({
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      }),
    });

    expect(result).toEqual({
      arguments: { text: 'hello world' },
      usedStdin: true,
    });
  });

  it('rejects raw stdin when the tool has no required string property', () => {
    expect(() =>
      resolveToolArguments({
        stdinText: 'hello world',
        tool: createTool({
          type: 'object',
          properties: {
            maxTokens: { type: 'number' },
          },
          required: ['maxTokens'],
        }),
      }),
    ).toThrow('has no string arguments');
  });

  it('rejects raw stdin when other required args remain', () => {
    expect(() =>
      resolveToolArguments({
        stdinText: 'hello world',
        tool: createTool({
          type: 'object',
          properties: {
            text: { type: 'string' },
            language: { type: 'string' },
          },
          required: ['text', 'language'],
        }),
      }),
    ).toThrow('Missing required argument: language');
  });
});

describe('formatToolCallOutput', () => {
  it('formats text and non-text content for text output', () => {
    const output = formatToolCallOutput(
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'image', mimeType: 'image/png', data: 'abc' },
            { type: 'resource', resource: { uri: 'file:///tmp/out.txt', text: 'ignored' } },
          ],
        },
      },
      'text',
      2000,
    );

    expect(output).toBe('hello\n[image: image/png]\n[resource: file:///tmp/out.txt]');
  });

  it('truncates compact output', () => {
    const output = formatToolCallOutput(
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: 'abcdefghijklmnopqrstuvwxyz' }],
        },
      },
      'compact',
      10,
    );

    expect(output).toBe('... [trunc');
  });

  it('returns json envelopes for raw output', () => {
    const output = formatToolCallOutput(
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: 'hello' }],
        },
      },
      'json',
      2000,
    );

    expect(output).toContain('"jsonrpc": "2.0"');
    expect(output).toContain('"hello"');
  });
});
