import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import type { MCPServerParams } from '@src/core/types/index.js';

export function getConfiguredServerTargets(): Record<string, MCPServerParams> {
  const manager = McpConfigManager.getInstance();
  return typeof manager.getConfiguredServerTargets === 'function'
    ? manager.getConfiguredServerTargets()
    : manager.getTransportConfig();
}
