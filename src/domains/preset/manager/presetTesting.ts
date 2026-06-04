import type { MCPServerParams } from '@src/core/types/index.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import { PresetConfig } from '@src/domains/preset/types/presetTypes.js';
import logger from '@src/logger/logger.js';

export interface PresetTestSummary {
  servers: string[];
  tags: string[];
}

export function testPresetAgainstServers(
  name: string,
  preset: PresetConfig,
  availableServers: Record<string, MCPServerParams>,
): PresetTestSummary {
  const matchingServers: string[] = [];
  const allTags = new Set<string>();

  for (const [serverName, serverConfig] of Object.entries(availableServers)) {
    const serverTags = serverConfig.tags || [];
    serverTags.forEach((tag: string) => allTags.add(tag));

    if (matchesPreset(name, preset, serverName, serverTags)) {
      matchingServers.push(serverName);
    }
  }

  return {
    servers: matchingServers,
    tags: Array.from(allTags).sort(),
  };
}

function matchesPreset(name: string, preset: PresetConfig, serverName: string, serverTags: string[]): boolean {
  try {
    let jsonQuery = preset.tagQuery;
    if (preset.strategy === 'advanced' && preset.tagQuery.$advanced) {
      jsonQuery = TagQueryParser.advancedQueryToJSON(String(preset.tagQuery.$advanced));
    }

    return TagQueryEvaluator.evaluate(jsonQuery, serverTags);
  } catch (error) {
    logger.warn('Failed to evaluate preset against server', {
      preset: name,
      server: serverName,
      error: error instanceof Error ? error.message : 'Unknown error',
      tagQuery: preset.tagQuery,
      serverTags,
    });
    return false;
  }
}
