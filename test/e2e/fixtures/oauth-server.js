#!/usr/bin/env node
/**
 * Mock OAuth-requiring MCP server for testing OAuth flow and notifications
 *
 * This server simulates a real OAuth-requiring MCP server that:
 * 1. Initially throws UnauthorizedError with OAuth URL
 * 2. After OAuth completion (simulated via environment variable), provides tools
 * 3. Tests the complete OAuth notification flow
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { sanitizeForLogging } from '@src/../src/logger/secureLogger.js';

// Track OAuth state - normally this would be persisted somewhere
let isAuthenticated = process.env.OAUTH_AUTHENTICATED === 'true';
const serverName = process.env.OAUTH_SERVER_NAME || 'oauth-test-server';
// Pre-sanitize server name for logging to prevent sensitive data exposure
const safeServerName = sanitizeForLogging(serverName);

class OAuthRequiredError extends Error {
  constructor(authorizationUrl) {
    super('OAuth authentication required');
    this.name = 'UnauthorizedError';
    this.authorizationUrl = authorizationUrl;
  }
}

class MockOAuthServer {
  constructor() {
    this.server = new Server(
      {
        name: serverName,
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupHandlers();
  }

  setupHandlers() {
    // List tools handler - requires OAuth
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!isAuthenticated) {
        const authUrl = `http://localhost:3000/oauth/authorize/${serverName}`;
        const error = new OAuthRequiredError(authUrl);
        error.authorizationUrl = authUrl;
        throw error;
      }

      // Return mock tools after OAuth completion
      const tools = [
        {
          name: 'oauth-protected-tool',
          description: 'A tool that was only available after OAuth authentication',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Message to process',
              },
            },
            required: ['message'],
          },
        },
        {
          name: 'user-data-tool',
          description: 'Access user-specific data (OAuth protected)',
          inputSchema: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                description: 'User ID to fetch data for',
              },
            },
            required: ['userId'],
          },
        },
      ];

      return { tools };
    });

    // Call tool handler - requires OAuth
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!isAuthenticated) {
        const authUrl = `http://localhost:3000/oauth/authorize/${serverName}`;
        const error = new OAuthRequiredError(authUrl);
        error.authorizationUrl = authUrl;
        throw error;
      }

      const { name, arguments: args } = request.params;

      switch (name) {
        case 'oauth-protected-tool':
          return {
            content: [
              {
                type: 'text',
                text: `OAuth protected response: ${args.message}`,
              },
            ],
          };

        case 'user-data-tool':
          return {
            content: [
              {
                type: 'text',
                text: `User data for ${args.userId}: {authenticated: true, permissions: ['read', 'write']}`,
              },
            ],
          };

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Log authentication status for debugging
    console.error(`OAuth server ${safeServerName} started. Authenticated: ${isAuthenticated}`);
  }
}

// Handle OAuth completion signal
process.on('SIGUSR1', () => {
  isAuthenticated = true;
  console.error(`OAuth server ${safeServerName} received authentication signal`);
});

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.error(`OAuth server ${safeServerName} shutting down`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error(`OAuth server ${safeServerName} shutting down`);
  process.exit(0);
});

// Start the server
const server = new MockOAuthServer();
server.run().catch((error) => {
  console.error('OAuth server error:', error);
  process.exit(1);
});
