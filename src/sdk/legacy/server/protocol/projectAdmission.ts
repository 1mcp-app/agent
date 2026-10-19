import { getProjectLifecycle, ProjectDrainingError, withProjectAdmission } from '@src/application/projectLifecycle.js';
import { getRequestSession } from '@src/core/protocol/requestHandlerUtils.js';
import { withRuntimeAdmission } from '@src/core/server/runtimeDrain.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import type { InboundConnection } from '@src/core/types/index.js';
import { getProjectBinding } from '@src/domains/project-selection/projectBindingScope.js';
import type { ContextData } from '@src/types/context.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

/** Retained SSE/stdio and restored sessions use their authoritative binding, even without new _meta. */
export function withInboundProjectAdmission<T, Args extends readonly unknown[]>(
  inbound: InboundConnection,
  work: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  return withRuntimeAdmission(async (...args: Args) => {
    if (!getProjectLifecycle()) return work(...args);
    const manager = ServerManager.current?.getTemplateServerManager?.();
    const context =
      getProjectBinding()?.context ?? manager?.getBindingContext?.(getRequestSession(inbound) ?? '') ?? inbound.context;
    try {
      return await withProjectAdmission(context as ContextData | undefined, () => work(...args));
    } catch (error) {
      if (error instanceof ProjectDrainingError) throw new MCPError(error.message, error.code, error.data);
      throw error;
    }
  });
}
