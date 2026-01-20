import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { zodToInputSchema, zodToOutputSchema } from '@src/utils/schemaUtils.js';

import { z } from 'zod';

/**
 * Lazy loading discovery tools
 * These tools provide on-demand access to the full tool registry
 */

/**
 * Zod schemas for lazy tool inputs
 */

const ToolListInputSchema = z.object({
  server: z.string().optional(),
  pattern: z.string().optional(),
  tag: z.string().optional(),
  limit: z.number().optional(),
});

const ToolSchemaInputSchema = z.object({
  server: z.string(),
  toolName: z.string(),
});

const ToolInvokeInputSchema = z.object({
  server: z.string(),
  toolName: z.string(),
  args: z.object({}).loose(),
});

/**
 * Zod schemas for lazy tool outputs
 */

const ToolMetadataSchema = z.object({
  name: z.string(),
  server: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
});

const ToolListOutputSchema = z.object({
  tools: z.array(ToolMetadataSchema),
  totalCount: z.number(),
  servers: z.array(z.string()),
  hasMore: z.boolean(),
  nextCursor: z.string().optional(),
  error: z
    .object({
      type: z.enum(['validation', 'upstream', 'not_found']),
      message: z.string(),
    })
    .optional(),
});

const ToolSchemaOutputSchema = z.object({
  schema: z.object({}).loose(),
  fromCache: z.boolean().optional(),
  error: z
    .object({
      type: z.enum(['validation', 'upstream', 'not_found']),
      message: z.string(),
    })
    .optional(),
});

const ToolInvokeOutputSchema = z.object({
  result: z.object({}).loose(),
  server: z.string(),
  tool: z.string(),
  error: z
    .object({
      type: z.enum(['validation', 'upstream', 'not_found']),
      message: z.string(),
    })
    .optional(),
});

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
