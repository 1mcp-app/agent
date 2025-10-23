/**
 * Model Context Protocol (MCP) constants
 */
import { ClientCapabilities, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

// MCP constants
export const MCP_CONFIG_FILE = 'mcp.json';
export const MCP_INSTRUCTIONS_TEMPLATE_FILE = 'instructions-template.md';
export const MCP_SERVER_NAME = '1mcp';
export const MCP_SERVER_VERSION = '0.25.5';

export const MCP_URI_SEPARATOR = '_1mcp_';

export const MCP_SERVER_CAPABILITIES: ServerCapabilities = {
  completions: {},
  resources: {
    listChanged: true,
  },
  tools: {
    listChanged: true,
  },
  prompts: {
    listChanged: true,
  },
  logging: {},
};

export const MCP_CLIENT_CAPABILITIES: ClientCapabilities = {
  roots: {
    listChanged: false,
  },
  sampling: {
    listChanged: false,
  },
  elicitation: {
    listChanged: false,
  },
};
