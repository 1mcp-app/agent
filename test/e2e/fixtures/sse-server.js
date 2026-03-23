#!/usr/bin/env node
/**
 * Mock MCP server over SSE transport for reproducing issue #255.
 *
 * Exposes:
 *   GET /sse   - SSE stream (MCP server-sent events)
 *   POST /message - inbound JSON-RPC messages
 *
 * Usage:
 *   node test/e2e/fixtures/sse-server.js --port=4001 --name=sse-server-1
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  InitializedNotificationSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import express from 'express';

// Parse CLI args
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? true];
    }),
);

const PORT = parseInt(args.port ?? '4001', 10);
const SERVER_NAME = args.name ?? `sse-server-${PORT}`;

// Track active SSE transports keyed by sessionId
const transports = new Map();

function createMcpServer() {
  const server = new Server({ name: SERVER_NAME, version: '1.0.0' }, { capabilities: { tools: {}, prompts: {} } });

  // Simulate the strict MCP session state machine that real servers implement.
  // After the initial handshake, receiving notifications/initialized again causes
  // the server to re-enter "initializing" state, rejecting tools/list and
  // prompts/list until initialization completes — reproducing issue #255.
  let initialized = false;
  let reinitializing = false;

  server.setNotificationHandler(InitializedNotificationSchema, async (notification) => {
    if (!initialized) {
      initialized = true;
      console.error(`[${SERVER_NAME}] Initial notifications/initialized received — session ready`);
    } else {
      console.error(
        `[${SERVER_NAME}] WARNING: received notifications/initialized AFTER initial handshake — ` +
          `re-entering initialization state. notification=${JSON.stringify(notification)}`,
      );
      reinitializing = true;
      // Simulate the server taking time to re-initialize (real servers stay in this
      // state until the new initialize/notifications/initialized cycle completes,
      // which never happens here since 1MCP doesn't re-do the handshake).
      setTimeout(() => {
        reinitializing = false;
      }, 2000);
    }
  });

  function assertReady(method) {
    if (reinitializing) {
      throw new Error(`method "${method}" is invalid during session initialization`);
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    assertReady('tools/list');
    console.error(`[${SERVER_NAME}] tools/list OK`);
    return {
      tools: [
        {
          name: `${SERVER_NAME}_tool`,
          description: `A tool from ${SERVER_NAME}`,
          inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (_req) => {
    assertReady('tools/call');
    return {
      content: [{ type: 'text', text: `${SERVER_NAME} called ${_req.params.name}` }],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    assertReady('prompts/list');
    console.error(`[${SERVER_NAME}] prompts/list OK`);
    return {
      prompts: [
        {
          name: `${SERVER_NAME}_prompt`,
          description: `A prompt from ${SERVER_NAME}`,
        },
      ],
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async () => {
    assertReady('prompts/get');
    return {
      description: `Prompt from ${SERVER_NAME}`,
      messages: [{ role: 'user', content: { type: 'text', text: `Hello from ${SERVER_NAME}` } }],
    };
  });

  return server;
}

const app = express();

// NOTE: do NOT apply express.json() globally — the /message route must receive
// the raw stream so SSEServerTransport.handlePostMessage can read it.
app.use('/health', express.json());
app.use('/sse', express.json());

app.get('/sse', async (req, res) => {
  console.error(`[${SERVER_NAME}] SSE connection opened`);
  const transport = new SSEServerTransport('/message', res);
  const server = createMcpServer();

  transports.set(transport.sessionId, transport);
  res.on('close', () => {
    console.error(`[${SERVER_NAME}] SSE connection closed (session=${transport.sessionId})`);
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
  console.error(`[${SERVER_NAME}] MCP session ready (session=${transport.sessionId})`);
});

app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: `Session not found: ${sessionId}` });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.get('/health', (_req, res) => res.json({ status: 'ok', server: SERVER_NAME }));

app.listen(PORT, () => {
  console.error(`[${SERVER_NAME}] listening on http://localhost:${PORT}`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
