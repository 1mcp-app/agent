import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { describe, expect, it } from 'vitest';

import {
  extractInspectServerInfo,
  extractInspectToolInfo,
  formatInspectOutput,
  parseInspectTarget,
} from './inspectUtils.js';

const toolSchemaResponse = {
  name: 'runner_1mcp_echo_args',
  description: 'Echo message payloads for testing.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Message to echo back.' },
      mode: {
        type: 'string',
        description: 'How to format the echo result.',
        enum: ['plain', 'json'],
        default: 'plain',
      },
      payload: {
        type: 'object',
        description: 'Optional metadata attached to the message.',
      },
    },
    required: ['message'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      echoed: { type: 'string' },
    },
  },
  annotations: undefined,
  examples: [{ message: 'hello' }],
} as unknown as Tool;

describe('inspectUtils', () => {
  it('parses bare server names and server/tool references', () => {
    expect(parseInspectTarget('runner')).toEqual({
      kind: 'server',
      serverName: 'runner',
    });

    expect(parseInspectTarget('runner/echo_args')).toEqual({
      kind: 'tool',
      reference: {
        serverName: 'runner',
        toolName: 'echo_args',
        qualifiedName: 'runner_1mcp_echo_args',
      },
    });
  });

  it('extracts normalized tool info from tool_schema content', () => {
    const info = extractInspectToolInfo(
      toolSchemaResponse,
      {
        serverName: 'runner',
        toolName: 'echo_args',
        qualifiedName: 'runner_1mcp_echo_args',
      },
      true,
    );

    expect(info.server).toBe('runner');
    expect(info.tool).toBe('echo_args');
    expect(info.qualifiedName).toBe('runner_1mcp_echo_args');
    expect(info.requiredArgs).toEqual([
      {
        name: 'message',
        required: true,
        type: 'string',
        description: 'Message to echo back.',
        defaultValue: undefined,
        enumValues: undefined,
      },
    ]);
    expect(info.optionalArgs[0]).toMatchObject({
      name: 'mode',
      required: false,
      type: 'string',
      enumValues: ['plain', 'json'],
      defaultValue: 'plain',
    });
    expect(info.outputSchema).toBeDefined();
    expect(info.examples).toEqual([{ message: 'hello' }]);
    expect(info.fromCache).toBe(true);
  });

  it('formats readable text output with sections', () => {
    const info = extractInspectToolInfo(
      toolSchemaResponse,
      {
        serverName: 'runner',
        toolName: 'echo_args',
        qualifiedName: 'runner_1mcp_echo_args',
      },
      true,
    );

    const output = formatInspectOutput(info, 'text');

    expect(output).toContain('Inspect: Tool');
    expect(output).toContain('qualified_name: runner_1mcp_echo_args');
    expect(output).toContain('required_args:');
    expect(output).toContain('- name: message');
    expect(output).toContain('type=string');
    expect(output).toContain('Message to echo back.');
    expect(output).toContain('optional_args:');
    expect(output).toContain('enum=plain | json');
    expect(output).toContain('output_schema:');
    expect(output).toContain('required_fields:');
    expect(output).toContain('- name: echoed');
    expect(output).toContain('optional_fields:');
    expect(output).toContain('schema_cache:');
    expect(output).toContain('examples:');
  });

  it('formats normalized json output', () => {
    const info = extractInspectToolInfo(
      toolSchemaResponse,
      {
        serverName: 'runner',
        toolName: 'echo_args',
        qualifiedName: 'runner_1mcp_echo_args',
      },
      true,
    );

    const output = formatInspectOutput(info, 'json');
    const parsed = JSON.parse(output) as { qualifiedName: string; requiredArgs: unknown[] };

    expect(parsed.qualifiedName).toBe('runner_1mcp_echo_args');
    expect(parsed.requiredArgs).toHaveLength(1);
  });

  it('formats a server-level tool listing', () => {
    const result = extractInspectServerInfo(
      'runner',
      [
        toolSchemaResponse,
        {
          name: 'runner_1mcp_summarize',
          description: 'Summarize text input.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
      ],
      true,
    );

    const output = formatInspectOutput(result, 'text');
    expect(output).toContain('Inspect: Server');
    expect(output).toContain('server: runner');
    expect(output).toContain('tools_total: 2');
    expect(output).toContain('- tool: echo_args');
    expect(output).toContain('required_args: 1');
    expect(output).toContain('optional_args: 2');
    expect(output).toContain('- tool: summarize');
    expect(output).toContain('optional_args: 0');
    expect(output).toContain('schema_cache:');
  });

  it('supports tools without optional metadata', () => {
    const info = extractInspectToolInfo(
      {
        name: 'runner_1mcp_minimal',
        inputSchema: { type: 'object' },
      },
      {
        serverName: 'runner',
        toolName: 'minimal',
        qualifiedName: 'runner_1mcp_minimal',
      },
    );

    expect(info.requiredArgs).toEqual([]);
    expect(info.optionalArgs).toEqual([]);
    expect(info.examples).toEqual([]);
  });
});
