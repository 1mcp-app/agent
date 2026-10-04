import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'tracing-fixture', version: '1' }, { capabilities: { tools: {}, logging: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'trace', inputSchema: { type: 'object' } }],
}));
let acceptRootsNotification;
server.setNotificationHandler(RootsListChangedNotificationSchema, async (notification) => {
  acceptRootsNotification?.(notification.params);
});
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  let forwardedNotification;

  if (request.params.arguments?.notify) {
    let timer;
    const received = new Promise((resolve, reject) => {
      acceptRootsNotification = resolve;
      timer = setTimeout(() => reject(new Error('Expected owned roots notification')), 2000);
    });
    await extra.sendNotification({
      method: 'notifications/message',
      params: {
        level: 'info',
        data: { baggage: 'legit-notification-data' },
        _meta: { baggage: 'secret-notification-carrier', other: 'preserved' },
      },
    });
    try {
      forwardedNotification = await received;
    } finally {
      clearTimeout(timer);
      acceptRootsNotification = undefined;
    }
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(request.params._meta ?? {}) }],
    _meta: { baggage: 'secret-response-carrier', other: 'preserved' },
    structuredContent: { baggage: 'legit', ...(forwardedNotification ? { forwardedNotification } : {}) },
  };
});
await server.connect(new StdioServerTransport());
