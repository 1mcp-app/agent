import { normalizeTags, resolveProjectContext } from '@src/config/projectConfigLoader.js';
import { type FilterSelectorInputs, resolveFilterSelection } from '@src/core/filtering/filterSelection.js';
import { TemplateFilteringService } from '@src/core/filtering/templateFilteringService.js';
import type { InboundConnectionConfig } from '@src/core/types/server.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import type { ContextData } from '@src/types/context.js';

import { requireProjectTarget, resolveProjectSelection } from './projectSelection.js';

export function hasExplicitProjectFilterSelection(filterConfig: InboundConnectionConfig): boolean {
  const mode = filterConfig.projectFilterMode ?? filterConfig.tagFilterMode;
  if (mode === 'none') return false;
  if (mode !== undefined) return true;
  return (
    filterConfig.presetName !== undefined ||
    filterConfig.tagQuery !== undefined ||
    filterConfig.tagExpression !== undefined ||
    (filterConfig.tags?.length ?? 0) > 0
  );
}

/** Resolve defaults from the selected checkout on the runtime. Client JSON carries no effective-policy assertions. */
export async function resolveProjectPolicies(
  context: ContextData,
  filterConfig: InboundConnectionConfig = {},
): Promise<InboundConnectionConfig[]> {
  const selection = resolveProjectSelection(context);
  if (selection.kind === 'unresolved') return [];
  // Preserve the existing explicit-selector precedence for a single checkout.
  // Combined selection always retains each runtime-derived member policy.
  if (selection.kind === 'single' && hasExplicitProjectFilterSelection(filterConfig)) {
    const { tags, tagExpression, tagQuery, tagFilterMode, presetName } = filterConfig;
    return [{ tags, tagExpression, tagQuery, tagFilterMode, presetName }];
  }
  return Promise.all(
    selection.projects.map(async (project) => {
      const { projectConfig } = await resolveProjectContext(project.path);
      let filters: FilterSelectorInputs = {};
      if (projectConfig?.preset !== undefined) {
        filters = { preset: projectConfig.preset };
      } else if (projectConfig?.filter !== undefined) {
        filters = { filter: projectConfig.filter };
      } else if (projectConfig?.tags !== undefined) {
        filters = { tags: normalizeTags(projectConfig.tags)?.join(',') };
      }
      const result = resolveFilterSelection(filters, {
        presetLookup: { getPreset: (name) => PresetManager.getInstance().getPreset(name) ?? undefined },
      });
      if (!result.ok) throw new Error(`Invalid project filter for ${project.label}: ${result.error.message}`);
      return result.selection.compatibility;
    }),
  );
}

export function isProjectBackendVisible(
  config: MCPServerParams | undefined,
  context: ContextData | undefined,
  policies: readonly InboundConnectionConfig[],
): boolean {
  if (!config) return true;
  const mode = config.projectTarget?.mode ?? (config.template ? 'single' : 'independent');
  if (mode === 'independent') return true;
  if (!context) return !config.projectTarget;
  const selected = resolveProjectSelection(context);
  if (selected.kind === 'unresolved') return false;
  if (selected.kind === 'native-set' && mode !== 'native-set') return false;
  return policies.every(
    (policy) => TemplateFilteringService.getMatchingTemplates([['backend', config]], policy).length === 1,
  );
}

/** Explain target ambiguity only for configured backends admitted by the request's existing filter. */
export function projectSelectionDiagnostic(
  config: MCPServerParams | undefined,
  context: ContextData | undefined,
  filterConfig: InboundConnectionConfig,
): string | undefined {
  if (!config || !context || config.disabled) return undefined;
  const mode = config.projectTarget?.mode ?? (config.template ? 'single' : 'independent');
  if (mode === 'independent') return undefined;
  if (TemplateFilteringService.getMatchingTemplates([['backend', config]], filterConfig).length === 0) return undefined;
  try {
    requireProjectTarget(context, mode);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

export function projectToolArguments(
  config: MCPServerParams | undefined,
  context: ContextData | undefined,
  args: unknown,
): unknown {
  if (!config?.projectTarget) return args;
  const { mode, argument } = config.projectTarget;
  if (mode === 'independent') return args;
  if (!context) throw new Error('Project Selection is unresolved. Use --project <checkout> or --project-set <file>');
  const selected = requireProjectTarget(context, mode);
  if (!argument) {
    if (!config.template)
      throw new Error(
        'This checkout-specific static backend has no target argument. Configure a target-bound template or an explicit projectTarget.argument.',
      );
    return args;
  }
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
    throw new Error('Project-targeted tool arguments must be an object');
  }
  const supplied = args as Record<string, unknown> | undefined;
  const target = mode === 'native-set' ? selected.map((project) => project.path) : selected[0].path;
  if (supplied?.[argument] !== undefined && JSON.stringify(supplied[argument]) !== JSON.stringify(target)) {
    throw new Error(`Tool argument '${argument}' conflicts with the explicit Project Selection`);
  }
  return { ...supplied, [argument]: target };
}
