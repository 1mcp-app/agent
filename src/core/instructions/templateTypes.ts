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
  /** Number of connected servers (e.g., 3) */
  serverCount: number;

  /** Boolean indicating if any servers are connected */
  hasServers: boolean;

  /** Newline-separated list of server names */
  serverList: string;

  /** Array of server names for iteration with {{#each}} */
  serverNames: string[];

  /** Array of server objects for detailed iteration with {{#each}} */
  servers: ServerData[];

  /** "server" or "servers" based on count */
  pluralServers: string;

  /** "is" or "are" based on count */
  isAre: string;

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
};

/**
 * Default instruction template using Handlebars syntax
 * This template is used when no custom template is provided
 */
export const DEFAULT_INSTRUCTION_TEMPLATE = `# {{title}}

{{#if hasServers}}
You are interacting with 1MCP, a proxy server that aggregates capabilities from multiple MCP (Model Context Protocol) servers. 1MCP acts as a unified gateway, allowing you to access tools and resources from various specialized MCP servers through a single connection.

## How 1MCP Works

- **Unified Access**: Connect to multiple MCP servers through one proxy
- **Tool Aggregation**: All tools are available with the naming pattern \`{{toolPattern}}\`
- **Resource Sharing**: Access files, data, and capabilities across different servers
- **Intelligent Routing**: Your requests are automatically routed to the appropriate servers

## Currently Connected Servers

{{serverCount}} MCP {{pluralServers}} {{isAre}} currently available{{filterContext}}:

{{serverList}}

## Available Capabilities

All tools from connected servers are accessible using the format: \`{{toolPattern}}\`

Examples:
{{#each examples}}
- \`{{name}}\` - {{description}}
{{/each}}

## Server-Specific Instructions

The following sections contain instructions from each connected MCP server. Each server's instructions are wrapped in XML-like tags (e.g., \`<server-name>instructions</server-name>\`) to clearly identify their source and scope.

{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{{instructions}}}
</{{name}}>

{{/if}}
{{/each}}

## Tips for Using 1MCP

- Tools are namespaced by server to avoid conflicts

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
