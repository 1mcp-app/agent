/**
 * JSON Schema version constants for IDE autocompletion support
 *
 * Schema version is independent from package version - only bump when schema structure changes.
 */

/**
 * Schema version for JSON Schema generation
 * This version is independent from package version and only changes when schema structure changes.
 */
export const SCHEMA_VERSION = 'v1.0.0' as const;

/**
 * Base URL for hosted JSON schemas
 */
export const SCHEMA_BASE_URL = 'https://docs.1mcp.app/schemas' as const;

/**
 * Full URL for MCP config schema
 */
export const MCP_CONFIG_SCHEMA_URL = `${SCHEMA_BASE_URL}/${SCHEMA_VERSION}/mcp-config.json` as const;

/**
 * Full URL for project config schema
 */
export const PROJECT_CONFIG_SCHEMA_URL = `${SCHEMA_BASE_URL}/${SCHEMA_VERSION}/project-config.json` as const;

/**
 * Local development path for MCP config schema
 */
export const MCP_CONFIG_SCHEMA_LOCAL = `./schemas/${SCHEMA_VERSION}/mcp-config.json` as const;

/**
 * Local development path for project config schema
 */
export const PROJECT_CONFIG_SCHEMA_LOCAL = `./schemas/${SCHEMA_VERSION}/project-config.json` as const;

/**
 * Default empty mcpServers object
 */
export const DEFAULT_MCP_SERVERS = {} as Record<string, unknown>;
