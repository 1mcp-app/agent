import { sanitizeRuntimeScopeError } from '@src/config/runtimeScopeEnv.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import { templateBackendLogSource } from '@src/domains/backend-logs/backendLogSource.js';
import { createTransportsWithContext } from '@src/transport/transportFactory.js';
import { getConnectionTimeout } from '@src/utils/core/timeoutUtils.js';

import type { PooledClientInstance } from './clientInstancePoolTypes.js';

export interface CreatePooledInstanceParams {
  instanceId: string;
  instanceKey: string;
  templateName: string;
  processedConfig: MCPServerParams;
  renderedHash: string;
  runtimeFingerprint: string;
  clientId: string;
  idleTimeout: number;
}

export async function createPooledClientInstance({
  instanceId,
  instanceKey,
  templateName,
  processedConfig,
  renderedHash,
  runtimeFingerprint,
  clientId,
  idleTimeout,
}: CreatePooledInstanceParams): Promise<PooledClientInstance> {
  const backendLogOptions =
    processedConfig.type === 'stdio' || (!processedConfig.type && Boolean(processedConfig.command))
      ? {
          backendLogSources: {
            [templateName]: templateBackendLogSource({ templateName, instanceId }),
          },
        }
      : undefined;
  const configs = { [templateName]: processedConfig };
  const transports = backendLogOptions
    ? await createTransportsWithContext(configs, undefined, backendLogOptions)
    : await createTransportsWithContext(configs, undefined);

  const transport = transports[templateName];
  if (!transport) {
    throw new Error(`Failed to create transport for template ${templateName}`);
  }

  const { ClientManager } = await import('@src/core/client/clientManager.js');
  const clientManager = ClientManager.getOrCreateInstance();
  const client = clientManager.createPooledClientInstance();

  const connectionTimeout = getConnectionTimeout(transport);
  try {
    await client.connect(transport, connectionTimeout ? { timeout: connectionTimeout } : undefined);
  } catch (error) {
    throw sanitizeRuntimeScopeError(error);
  }

  return {
    id: instanceId,
    instanceKey,
    templateName,
    client,
    transport,
    renderedHash,
    runtimeFingerprint,
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
