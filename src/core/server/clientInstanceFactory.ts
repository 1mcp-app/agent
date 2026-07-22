import type { MCPServerParams } from '@src/core/types/transport.js';
import { createTransportsWithContext } from '@src/transport/transportFactory.js';
import { getConnectionTimeout } from '@src/utils/core/timeoutUtils.js';

import type { PooledClientInstance } from './clientInstancePoolTypes.js';

export interface CreatePooledInstanceParams {
  instanceId: string;
  instanceKey: string;
  templateName: string;
  processedConfig: MCPServerParams;
  renderedHash: string;
  clientId: string;
  idleTimeout: number;
}

export async function createPooledClientInstance({
  instanceId,
  instanceKey,
  templateName,
  processedConfig,
  renderedHash,
  clientId,
  idleTimeout,
}: CreatePooledInstanceParams): Promise<PooledClientInstance> {
  const transports = await createTransportsWithContext(
    {
      [templateName]: processedConfig,
    },
    undefined,
  );

  const transport = transports[templateName];
  if (!transport) {
    throw new Error(`Failed to create transport for template ${templateName}`);
  }

  const { ClientManager } = await import('@src/core/client/clientManager.js');
  const clientManager = ClientManager.getOrCreateInstance();
  const client = clientManager.createPooledClientInstance();

  const connectionTimeout = getConnectionTimeout(transport);
  await client.connect(transport, connectionTimeout ? { timeout: connectionTimeout } : undefined);

  return {
    id: instanceId,
    instanceKey,
    templateName,
    client,
    transport,
    renderedHash,
    processedConfig,
    referenceCount: 1,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    status: 'active',
    outboundKeys: new Set(),
    clientIds: new Set([clientId]),
    idleTimeout,
  };
}
