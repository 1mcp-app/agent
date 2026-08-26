import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import type { MCPServerParams } from '@src/core/types/index.js';

export function getConfiguredServerTargets(): Record<string, MCPServerParams> {
  const manager = McpConfigManager.getInstance();
  return typeof manager.getConfiguredServerTargets === 'function'
    ? manager.getConfiguredServerTargets()
    : manager.getTransportConfig();
}

export function isOperatorDisabledTemplateDefinition(config: MCPServerParams): boolean {
  if (typeof config.disabled !== 'string') return config.disabled === true;
  const normalized = config.disabled.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}
