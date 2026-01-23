import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { zodToInputSchema, zodToOutputSchema } from '@src/utils/schemaUtils.js';

import {
  ToolInvokeInputSchema,
  ToolInvokeOutputSchema,
  ToolListInputSchema,
  ToolListOutputSchema,
  ToolSchemaInputSchema,
  ToolSchemaOutputSchema,
} from '../schemas/metaToolSchemas.js';

/**
 * Lazy loading discovery tools
 * These tools provide on-demand access to the full tool registry
 */

export function createToolListTool(): Tool {
  return {
    name: 'tool_list',
    description: 'List all available MCP tools with names and descriptions. Use for tool discovery.',
    inputSchema: zodToInputSchema(ToolListInputSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(ToolListOutputSchema) as Tool['outputSchema'],
  };
}

export function createToolSchemaTool(): Tool {
  return {
    name: 'tool_schema',
    description: 'Get the full schema for a specific tool including input validation rules',
    inputSchema: zodToInputSchema(ToolSchemaInputSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(ToolSchemaOutputSchema) as Tool['outputSchema'],
  };
}

export function createToolInvokeTool(): Tool {
  return {
    name: 'tool_invoke',
    description: 'Execute any tool on any MCP server with proper argument validation',
    inputSchema: zodToInputSchema(ToolInvokeInputSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(ToolInvokeOutputSchema) as Tool['outputSchema'],
  };
}

export const LAZY_TOOLS = ['tool_list', 'tool_schema', 'tool_invoke'] as const;
export type LazyToolName = (typeof LAZY_TOOLS)[number];
