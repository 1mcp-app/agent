/**
 * JSON Schema definitions for MCP tools
 */

export const SearchMCPServersArgsSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query to match against server names and descriptions',
    },
    status: {
      type: 'string',
      enum: ['active', 'archived', 'deprecated', 'all'],
      default: 'active',
      description: 'Filter by server status',
    },
    registry_type: {
      type: 'string',
      enum: ['npm', 'pypi', 'docker'],
      description: 'Filter by package registry type',
    },
    transport: {
      type: 'string',
      enum: ['stdio', 'sse', 'webhook'],
      description: 'Filter by transport method',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
      description: 'Maximum number of results to return',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      default: 0,
      description: 'Number of results to skip for pagination',
    },
  },
  additionalProperties: false,
} as const;

export const GetRegistryStatusArgsSchema = {
  type: 'object',
  properties: {
    include_stats: {
      type: 'boolean',
      default: false,
      description: 'Include detailed server count statistics in the response',
    },
  },
  additionalProperties: false,
} as const;

// Type definitions derived from schemas
export interface SearchMCPServersArgs {
  query?: string;
  status?: 'active' | 'archived' | 'deprecated' | 'all';
  registry_type?: 'npm' | 'pypi' | 'docker';
  transport?: 'stdio' | 'sse' | 'webhook';
  limit?: number;
  offset?: number;
}

export interface GetRegistryStatusArgs {
  include_stats?: boolean;
}
