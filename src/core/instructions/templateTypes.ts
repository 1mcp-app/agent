/**
 * Individual server data for template iteration
 */
export interface ServerData {
  /** Server name (e.g., "api-server") */
  name: string;

  /** Server instructions content */
  instructions: string;

  /** Whether this server has instructions */
  hasInstructions: boolean;
}

/**
 * Template variables available for custom instruction templates
 * These variables are provided by 1MCP and can be used in Handlebars templates
 */
export interface TemplateVariables {
  // Basic server state
  /** Number of connected servers with instructions (e.g., 3) - LEGACY: kept for backward compatibility */
  serverCount: number;

  /** Number of connected servers with instructions (same as serverCount, clearer name) */
  instructionalServerCount: number;

  /** Total number of connected servers (including those without instructions) */
  connectedServerCount: number;

  /** Boolean indicating if any servers with instructions are connected */
  hasServers: boolean;

  /** Boolean indicating if any servers with instructions are connected */
  hasInstructionalServers: boolean;

  /** Newline-separated list of server names */
  serverList: string;

  /** Array of server names for iteration with {{#each}} */
  serverNames: string[];

  /** Array of server objects for detailed iteration with {{#each}} */
  servers: ServerData[];

  /** "server" or "servers" based on count */
  pluralServers: string;

  /** "is" or "are" based on instructional server count */
  isAre: string;

  /** "server" or "servers" based on connected server count */
  connectedPluralServers: string;

  /** "is" or "are" based on connected server count */
  connectedIsAre: string;

  // Content
  /** All server instructions wrapped in XML-like tags */
  instructions: string;

  /** Filter description (e.g., " (filtered by tags: backend)") or empty string */
  filterContext: string;

  // Configuration
  /** Tool naming pattern (default: "{server}_1mcp_{tool}") */
  toolPattern: string;

  /** Title for the template (default: "1MCP - Model Context Protocol Proxy") */
  title: string;

  /** Array of tool examples for documentation */
  examples: TemplateExample[];

  // Lazy loading state (present when lazy loading is configured)
  /** Lazy loading configuration and statistics */
  lazyLoading?: LazyLoadingState;
}

/**
 * Lazy loading state for template variables
 * Present when lazy loading is configured (enabled or disabled)
 */
export interface LazyLoadingState {
  /** Whether lazy loading is enabled */
  enabled: boolean;

  /** Lazy loading mode */
  mode: 'metatool' | 'hybrid' | 'full';

  /** Total number of tools available across all servers */
  availableToolsCount: number;

  /** Number of tools exposed via tools/list (varies by mode) */
  exposedToolsCount: number;

  /** Number of tools in directExpose list (hybrid mode only) */
  directExposeCount: number;

  /** Number of tools currently cached with schemas */
  cachedToolsCount: number;

  /** Meta-tool names (metatool mode only) */
  metaTools?: string[];

  /** Full tool catalog (if inlineCatalog=true) */
  catalog?: ToolCatalogEntry[];
}

/**
 * Tool catalog entry for inline catalog
 */
export interface ToolCatalogEntry {
  /** Tool name */
  name: string;

  /** Server name */
  server: string;

  /** Tool description */
  description?: string;

  /** Tool category (derived from server name) */
  category?: string;
}

/**
 * Tool example for template documentation
 */
export interface TemplateExample {
  /** Tool name with pattern applied (e.g., "filesystem_1mcp_read_file") */
  name: string;

  /** Description of what the tool does */
  description: string;
}

/**
 * Template configuration options
 */
export interface TemplateConfig {
  /** Custom Handlebars template string */
  customTemplate?: string;

  /** Override default title */
  title?: string;

  /** Override default tool pattern */
  toolPattern?: string;

  /** Custom tool examples */
  examples?: TemplateExample[];

  /** Maximum template size in bytes (default: 1MB) */
  templateSizeLimit?: number;
}

/**
 * Default template examples
 */
export const DEFAULT_TEMPLATE_EXAMPLES: TemplateExample[] = [
  {
    name: 'filesystem_1mcp_read_file',
    description: 'Read files through filesystem server',
  },
  {
    name: 'web_1mcp_search',
    description: 'Search the web through web server',
  },
  {
    name: 'database_1mcp_query',
    description: 'Query databases through database server',
  },
];

/**
 * Default template configuration values
 */
export const DEFAULT_TEMPLATE_CONFIG: Required<Omit<TemplateConfig, 'customTemplate'>> = {
  title: '1MCP - Model Context Protocol Proxy',
  toolPattern: '{server}_1mcp_{tool}',
  examples: DEFAULT_TEMPLATE_EXAMPLES,
  templateSizeLimit: 1024 * 1024, // 1MB default
};

/**
 * Default instruction template using Handlebars syntax
 * This template is used when no custom template is provided
 */
export const DEFAULT_INSTRUCTION_TEMPLATE = `# {{title}}

{{#if hasServers}}
You are interacting with 1MCP, a proxy server that aggregates capabilities from multiple MCP (Model Context Protocol) servers. 1MCP acts as a unified gateway, allowing you to access tools and resources from various specialized MCP servers through a single connection.

{{#if lazyLoading.enabled}}
## Tool Access: Meta-Tool Discovery Mode

1MCP is running in {{lazyLoading.mode}} mode for optimized token usage. Tools are loaded on-demand using meta-tools for discovery.

### Meta-Tool Workflow

When you need to use a tool, follow this three-step discovery process:

1. **List Available Tools**: Call \`mcp_list_available_tools\` to see all available tools
   - Returns tool names, source servers, and descriptions
   - Use optional filters: \`server\`, \`pattern\`, \`tag\`, \`limit\`, \`cursor\`

2. **Describe Tool**: Call \`mcp_describe_tool\` with \`server\` and \`toolName\` to get the full input schema
   - Returns complete tool definition including required parameters
   - Load schema only when you need to use the tool

3. **Call Tool**: Invoke \`mcp_call_tool\` with \`server\`, \`toolName\`, and \`args\`
   - Executes the tool on the upstream server
   - Returns the result with structured responses

### Error Handling

Meta-tools use structured error responses with \`_errorType\` field:

- **validation_error**: Missing or invalid parameters
  - Fix: Provide all required parameters with correct types

- **not_found_error**: Tool or server not found
  - Fix: Call \`mcp_list_available_tools\` to verify tool exists

- **upstream_error**: Server-side error or connection issue
  - Fix: This is an upstream server issue - may need to retry or report

### Tool Categories

Tools are organized by server for easier discovery:
{{#each servers}}
- **{{name}}**: {{#if hasInstructions}}{{description}}{{else}}Various tools from {{name}}{{/if}}
{{/each}}

{{#if lazyLoading.catalog}}
### Tool Catalog ({{lazyLoading.availableToolsCount}} tools)

{{#each lazyLoading.catalog}}
- \`{{server}}:{{name}}\` - {{description}}
{{/each}}

{{#if (gt lazyLoading.availableToolsCount 100)}}
### Pagination for Large Tool Sets

When working with many tools, use pagination:
- Start with \`mcp_list_available_tools\` with \`limit\` parameter
- Use returned \`cursor\` for next page
- Continue until \`hasMore\` is false
{{/if}}
{{/if}}

{{else}}
## How 1MCP Works

- **Unified Access**: Connect to multiple MCP servers through one proxy
- **Tool Aggregation**: All tools are available with the naming pattern \`{{toolPattern}}\`
- **Resource Sharing**: Access files, data, and capabilities across different servers
- **Intelligent Routing**: Your requests are automatically routed to the appropriate servers
{{/if}}

## Currently Connected Servers

{{connectedServerCount}} MCP {{connectedPluralServers}} {{connectedIsAre}} currently available{{filterContext}}:

{{#each servers}}
{{name}}
{{/each}}

{{#if hasInstructionalServers}}
{{#unless lazyLoading.enabled}}
## Available Capabilities

All tools from connected servers are accessible using the format: \`{{toolPattern}}\`

Examples:
{{#each examples}}
- \`{{name}}\` - {{description}}
{{/each}}
{{/unless}}

## Server-Specific Instructions

The following sections contain instructions from each connected MCP server. Each server's instructions are wrapped in XML-like tags (e.g., \`<server-name>instructions</server-name>\`) to clearly identify their source and scope.

{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>

{{/if}}
{{/each}}

## Tips for Using 1MCP

{{#if lazyLoading.enabled}}
- Use meta-tools for efficient tool discovery and on-demand loading
- Tools are organized by server name to avoid naming conflicts
- Cache statistics: {{lazyLoading.cachedToolsCount}}/{{lazyLoading.availableToolsCount}} tools loaded
- Call \`mcp_list_available_tools\` first to discover available tools
{{else}}
- Tools are namespaced by server to avoid conflicts
{{/if}}

{{else}}
## Status

Connected servers are available but have not provided instructions yet. Tools and capabilities will become available once servers provide their instructions.
{{/if}}

{{else}}
You are interacting with 1MCP, a proxy server that aggregates capabilities from multiple MCP (Model Context Protocol) servers.

## Current Status

No MCP servers are currently connected. 1MCP is ready to connect to servers and provide unified access to their capabilities once they become available.

## What 1MCP Provides

- **Unified Access**: Connect to multiple MCP servers through one proxy
- **Tool Aggregation**: Access tools using the pattern \`{{toolPattern}}\`
- **Resource Sharing**: Share files, data, and capabilities across servers
- **Intelligent Routing**: Automatic request routing to appropriate servers

1MCP will automatically detect and connect to available MCP servers. Once connected, their tools and capabilities will become available through the unified interface.
{{/if}}`;
