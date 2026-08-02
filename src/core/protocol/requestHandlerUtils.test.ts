import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { OutboundConnections } from '@src/core/types/index.js';
import { createMockClient, createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { describe, expect, it, vi } from 'vitest';

import { createCapabilityCatalogFromConnections } from './requestHandlerUtils.js';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return {
        getTemplateServerManager: () => undefined,
      };
    },
  },
}));

describe('createCapabilityCatalogFromConnections', () => {
  it('preserves healthy tools when another backend times out and recovers on the next construction', async () => {
    const recoveredTool = { name: 'recovered', inputSchema: { type: 'object' as const } };
    const healthyTool = { name: 'healthy', inputSchema: { type: 'object' as const } };
    const slowListTools = vi
      .fn<Client['listTools']>()
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockResolvedValueOnce({ tools: [recoveredTool] });
    const healthyListTools = vi.fn<Client['listTools']>().mockResolvedValue({ tools: [healthyTool] });
    const connections: OutboundConnections = new Map([
      [
        'slow',
        createMockOutboundConnection({
          name: 'slow',
          client: createMockClient({ listTools: slowListTools }) as Client,
        }),
      ],
      [
        'healthy',
        createMockOutboundConnection({
          name: 'healthy',
          client: createMockClient({ listTools: healthyListTools }) as Client,
        }),
      ],
    ]);

    const partialCatalog = await createCapabilityCatalogFromConnections(connections, () => ({}));
    const partial = await partialCatalog.listVisibleTools();
    expect(partial.tools.map((tool) => tool.name)).toEqual(['healthy']);

    const recoveredCatalog = await createCapabilityCatalogFromConnections(connections, () => ({}));
    const recovered = await recoveredCatalog.listVisibleTools();
    expect(recovered.tools.map((tool) => tool.name).sort()).toEqual(['healthy', 'recovered']);
    expect(slowListTools).toHaveBeenCalledTimes(2);
  });
});
