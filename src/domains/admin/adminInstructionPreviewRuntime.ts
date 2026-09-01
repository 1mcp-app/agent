import { randomUUID } from 'node:crypto';

import { ConfigManager } from '@src/config/configManager.js';
import { createRenderableOutboundConnection } from '@src/core/client/renderableOutboundConnection.js';
import type { TrustedTemplateContext } from '@src/core/context/templateContextTrust.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { createConnectionResolver } from '@src/core/server/connectionResolver.js';
import { prepareRequestContext } from '@src/core/server/requestContextPreparation.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';
import type { InboundConnectionConfig } from '@src/core/types/server.js';
import type { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import { createRequestContextPreparationDependencies } from '@src/transport/http/routes/inspectRequestContext.js';
import { deriveContextSessionId } from '@src/transport/http/utils/contextExtractor.js';
import type { ContextData } from '@src/types/context.js';
import { normalizeTag } from '@src/utils/validation/sanitization.js';

import type { AdminInstructionPreviewInput, AdminInstructionPreviewResult } from './adminInstructionTemplateService.js';

export function createAdminInstructionPreviewRuntime(
  serverManager: ServerManager,
  presetManager?: PresetManager,
  authorizeContext?: (context: ContextData) => TrustedTemplateContext | undefined,
): (input: AdminInstructionPreviewInput) => Promise<AdminInstructionPreviewResult> {
  return async (input) => {
    const aggregator = serverManager.getInstructionAggregator();
    if (!aggregator) {
      return {
        surface: input.surface === 'initialization' ? 'initialize' : 'cli',
        validation: {
          valid: false,
          code: 'runtime_instructions_unavailable',
          message: 'Runtime instructions are unavailable',
        },
        effectiveServers: [],
        unresolvedTemplates: [],
      };
    }

    let preparedSessionId: string | undefined;
    try {
      const filterConfig = toFilterConfig(input, presetManager);
      if (!filterConfig) {
        return invalidPreview(input, 'preset_not_found', 'The selected preset does not exist');
      }
      const declared = ConfigManager.getInstance().loadDeclaredServerConfigs();
      if (input.requestContext) {
        const rawContext = {
          ...input.requestContext,
          sessionId: `admin-preview-${randomUUID()}`,
        };
        const context = authorizeContext?.(rawContext);
        if (!context) {
          return invalidPreview(input, 'request_context_untrusted', 'Request context could not be authorized');
        }
        preparedSessionId = deriveContextSessionId(context);
        await prepareRequestContext({
          deps: createRequestContextPreparationDependencies(serverManager),
          context,
          filterConfig,
        });
      }

      const sessionConnections = createConnectionResolver(
        serverManager.getClients(),
        serverManager.getTemplateServerManager(),
      ).filterForSession(preparedSessionId);
      const filtered = FilteringService.getFilteredConnections(sessionConnections, filterConfig);
      const representedTemplateNames = new Set(
        Array.from(filtered.entries())
          .filter(([key, connection]) => key !== connection.name || key.startsWith(`${connection.name}:`))
          .map(([, connection]) => connection.name),
      );
      try {
        const previewConnections: OutboundConnections = new Map(filtered);
        for (const [name, config] of Object.entries(declared.staticServers)) {
          if (previewConnections.has(name) || !matchesFilter(config.tags, filterConfig)) continue;
          previewConnections.set(
            name,
            createRenderableOutboundConnection(name, config.tags, ClientStatus.Disconnected),
          );
        }
        return {
          surface: input.surface === 'initialization' ? 'initialize' : 'cli',
          rendered: aggregator.previewInstructions(input.template, filterConfig, previewConnections),
          effectiveServers: Array.from(previewConnections.entries()).map(([key, connection]) => ({
            target: {
              source: key !== connection.name && key.startsWith(`${connection.name}:`) ? 'mcpTemplates' : 'mcpServers',
              name: connection.name,
            },
            hasInstructions: Boolean(aggregator.getEffectiveServerInstructions(key, connection.name)),
          })),
          unresolvedTemplates: Object.entries(declared.templateServers)
            .filter(([name, config]) => !representedTemplateNames.has(name) && matchesFilter(config.tags, filterConfig))
            .map(([name]) => name),
        };
      } catch (_error) {
        return {
          surface: input.surface === 'initialization' ? 'initialize' : 'cli',
          validation: {
            valid: false,
            code: 'instruction_template_render_failed',
            message: 'Template rendering failed',
          },
          effectiveServers: [],
          unresolvedTemplates: Object.entries(declared.templateServers)
            .filter(([, config]) => matchesFilter(config.tags, filterConfig))
            .map(([name]) => name),
        };
      }
    } catch {
      return invalidPreview(input, 'instruction_preview_failed', 'Instruction preview preparation failed');
    } finally {
      if (preparedSessionId) {
        try {
          await serverManager
            .getTemplateServerManager()
            .cleanupTemplateServers(preparedSessionId, serverManager.getClients(), serverManager.getClientTransports());
        } catch (_error) {
          // Do not expose runtime paths or configuration details through cleanup failures.
        }
      }
    }
  };
}

function matchesFilter(tags: string[] | undefined, filterConfig: InboundConnectionConfig): boolean {
  if (!filterConfig.tagFilterMode || filterConfig.tagFilterMode === 'none' || filterConfig.tagFilterMode === 'preset') {
    return true;
  }
  if (filterConfig.tagFilterMode === 'advanced' && filterConfig.tagExpression) {
    return TagQueryParser.evaluate(filterConfig.tagExpression, tags ?? []);
  }
  const requested = (filterConfig.tags ?? []).map(normalizeTag);
  return requested.length === 0 || (tags ?? []).map(normalizeTag).some((tag) => requested.includes(tag));
}

function invalidPreview(
  input: AdminInstructionPreviewInput,
  code: string,
  message: string,
): AdminInstructionPreviewResult {
  return {
    surface: input.surface === 'initialization' ? 'initialize' : 'cli',
    validation: { valid: false, code, message },
    effectiveServers: [],
    unresolvedTemplates: [],
  };
}

function toFilterConfig(
  input: AdminInstructionPreviewInput,
  presetManager?: PresetManager,
): InboundConnectionConfig | undefined {
  switch (input.selection.mode) {
    case 'tags':
      return { tagFilterMode: 'simple-or', tags: input.selection.tags };
    case 'tag-filter':
      return { tagFilterMode: 'advanced', tagExpression: TagQueryParser.parseAdvanced(input.selection.expression) };
    case 'preset': {
      const expression = presetManager?.resolvePresetToExpression(input.selection.preset);
      return expression
        ? {
            tagFilterMode: 'advanced',
            tagExpression: TagQueryParser.parseAdvanced(expression),
            presetName: input.selection.preset,
          }
        : undefined;
    }
    default:
      return { tagFilterMode: 'none' };
  }
}
