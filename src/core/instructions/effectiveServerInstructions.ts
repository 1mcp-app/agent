import type { MCPServerParams } from '@src/core/types/transport.js';
import type { ConfiguredServerTargetSource } from '@src/domains/config-change/types.js';

export interface ConfiguredServerInstructionTarget {
  source: ConfiguredServerTargetSource;
  name: string;
}

export interface ConfiguredServerInstructionTargets {
  mcpServers: Record<string, Pick<MCPServerParams, 'instructionOverride'>>;
  mcpTemplates: Record<string, Pick<MCPServerParams, 'instructionOverride'>>;
}

export function resolveEffectiveServerInstructions(input: {
  target: ConfiguredServerInstructionTarget;
  upstreamInstructions: string | undefined;
  configuredTargets: ConfiguredServerInstructionTargets;
}): string | undefined {
  const configuredTarget = input.configuredTargets[input.target.source][input.target.name];
  if (configuredTarget && Object.hasOwn(configuredTarget, 'instructionOverride')) {
    return configuredTarget.instructionOverride;
  }
  return input.upstreamInstructions;
}

export function hasConfiguredInstructionOverride(
  target: ConfiguredServerInstructionTarget,
  configuredTargets: ConfiguredServerInstructionTargets,
): boolean {
  const configuredTarget = configuredTargets[target.source][target.name];
  return Boolean(configuredTarget && Object.hasOwn(configuredTarget, 'instructionOverride'));
}
