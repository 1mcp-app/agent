import prompts from 'prompts';
import { McpConfigManager } from '../config/mcpConfigManager.js';
import { PresetStrategy, PresetConfig, TagQuery } from './presetTypes.js';
import { TagQueryEvaluator } from './tagQueryEvaluator.js';
import logger from '../logger/logger.js';

/**
 * Interactive server selection result
 */
export interface SelectionResult {
  strategy: PresetStrategy;
  tagQuery: TagQuery;
  cancelled: boolean;
}

/**
 * Interactive CLI utility for server selection with arrow key navigation
 */
export class InteractiveSelector {
  private mcpConfig: McpConfigManager;

  constructor() {
    this.mcpConfig = McpConfigManager.getInstance();
  }

  /**
   * Interactive tag-based selection with strategy configuration and back navigation
   */
  public async selectServers(existingConfig?: Partial<PresetConfig>): Promise<SelectionResult> {
    console.log('\n┌────────────────── MCP Preset Configuration ─────────────────┐');
    console.log('│                                                            │');
    console.log('│ Configure your preset selection strategy:                 │');
    console.log('│                                                            │');

    try {
      // Get available servers and collect all tags
      const servers = this.mcpConfig.getTransportConfig();
      if (Object.keys(servers).length === 0) {
        console.log('│ ⚠️  No MCP servers found in configuration               │');
        console.log('└──────────────────────────────────────────────────────────┘\n');
        return {
          strategy: 'or',
          tagQuery: {},
          cancelled: true,
        };
      }

      // Collect all available tags from all servers
      const allTags = new Set<string>();
      for (const serverConfig of Object.values(servers)) {
        if (serverConfig.tags) {
          serverConfig.tags.forEach((tag: string) => allTags.add(tag));
        }
      }

      const availableTags = Array.from(allTags).sort();
      if (availableTags.length === 0) {
        console.log('│ ⚠️  No tags found in server configuration               │');
        console.log('└──────────────────────────────────────────────────────────┘\n');
        return {
          strategy: 'or',
          tagQuery: {},
          cancelled: true,
        };
      }

      // Main interaction loop with back navigation support
      let strategy: PresetStrategy | undefined;
      let tagQuery: TagQuery = {};
      let completed = false;

      while (!completed) {
        // Step 1: Strategy selection
        const strategyChoices = [
          {
            title: 'Match ANY selected tags (OR logic)',
            description: 'Servers that have ANY of the selected tags',
            value: 'or' as PresetStrategy,
          },
          {
            title: 'Match ALL selected tags (AND logic)',
            description: 'Servers that have ALL of the selected tags',
            value: 'and' as PresetStrategy,
          },
          {
            title: 'Custom JSON query',
            description: 'Advanced JSON-based query for complex filtering',
            value: 'advanced' as PresetStrategy,
          },
        ];

        const strategySelection = await prompts({
          type: 'select',
          name: 'strategy',
          message: 'Select filtering strategy:',
          choices: strategyChoices,
          initial: existingConfig?.strategy === 'and' ? 1 : existingConfig?.strategy === 'advanced' ? 2 : 0,
        });

        if (strategySelection.strategy === undefined) {
          console.log('└──────────────────────────────────────────────────────────┘\n');
          return {
            strategy: 'or',
            tagQuery: {},
            cancelled: true,
          };
        }

        strategy = strategySelection.strategy;

        // Step 2: Create query based on strategy
        if (strategy === 'advanced') {
          // Custom JSON query input
          const queryInput = await prompts({
            type: 'text',
            name: 'query',
            message: 'Enter JSON query (e.g., {"tag": "web"}, {"$or": [{"tag": "web"}, {"tag": "api"}]}):',
            initial: existingConfig?.tagQuery ? JSON.stringify(existingConfig.tagQuery, null, 2) : '{"tag": ""}',
            validate: (value: string) => {
              if (!value.trim()) {
                return 'Query cannot be empty';
              }
              try {
                const parsed = JSON.parse(value.trim());
                const validation = TagQueryEvaluator.validateQuery(parsed);
                if (!validation.isValid) {
                  return `Invalid query: ${validation.errors.join(', ')}`;
                }
                return true;
              } catch (error) {
                return `Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`;
              }
            },
          });

          if (queryInput.query === undefined) {
            console.log('└──────────────────────────────────────────────────────────┘\n');
            return {
              strategy: 'or',
              tagQuery: {},
              cancelled: true,
            };
          }

          tagQuery = JSON.parse(queryInput.query.trim());
          completed = true;
        } else {
          // Step 2: Tag selection for simple strategies with back navigation
          let selectedTags: string[] = [];
          let tagSelectionDone = false;

          while (!tagSelectionDone) {
            const tagChoices = [
              ...availableTags.map((tag) => ({
                title: tag,
                description: `Select servers with "${tag}" tag`,
                value: tag,
                selected: selectedTags.includes(tag),
              })),
              {
                title: '← Back to strategy selection',
                description: 'Go back to choose a different strategy',
                value: '__back__',
                selected: false,
              },
            ];

            const tagSelection = await prompts({
              type: 'multiselect',
              name: 'tags',
              message: `Select tags to ${strategy === 'and' ? 'require (ALL must match)' : 'include (ANY can match)'}:`,
              choices: tagChoices,
              min: 0,
              hint: '- Space to select. Return to submit. Select "Back" to change strategy',
              instructions: false,
            });

            if (tagSelection.tags === undefined) {
              console.log('└──────────────────────────────────────────────────────────┘\n');
              return {
                strategy: 'or',
                tagQuery: {},
                cancelled: true,
              };
            }

            const tags: string[] = tagSelection.tags;

            if (tags.includes('__back__')) {
              // User wants to go back to strategy selection
              strategy = undefined;
              break;
            }

            if (tags.filter((t) => t !== '__back__').length === 0) {
              console.log('│ ⚠️  Please select at least one tag or use "Back"        │');
              continue;
            }

            selectedTags = tags.filter((t) => t !== '__back__');
            tagSelectionDone = true;
          }

          // If user went back, restart from strategy selection
          if (!strategy) {
            continue;
          }

          // Create appropriate JSON query
          if (selectedTags.length === 1) {
            tagQuery = { tag: selectedTags[0] };
          } else if (strategy === 'and') {
            tagQuery = { $and: selectedTags.map((tag) => ({ tag })) };
          } else {
            tagQuery = { $or: selectedTags.map((tag) => ({ tag })) };
          }
          completed = true;
        }

        // Step 3: Preview and confirmation
        if (completed) {
          const queryString = TagQueryEvaluator.queryToString(tagQuery);
          console.log('│                                                            │');
          console.log(`│ Preview query: ${queryString.padEnd(42)} │`);
          console.log('│                                                            │');

          // Show matching servers
          const matchingServers = Object.entries(servers)
            .filter(([, serverConfig]) => {
              const serverTags = serverConfig.tags || [];
              return TagQueryEvaluator.evaluate(tagQuery, serverTags);
            })
            .map(([serverName]) => serverName);

          console.log(
            `│ Matching servers (${matchingServers.length}): ${matchingServers.slice(0, 3).join(', ').padEnd(31)} │`,
          );
          if (matchingServers.length > 3) {
            console.log(`│ ... and ${matchingServers.length - 3} more${' '.repeat(42)} │`);
          }
          console.log('│                                                            │');
          console.log('└────────────────────────────────────────────────────────────┘\n');
        }
      }

      return {
        strategy: strategy!,
        tagQuery,
        cancelled: false,
      };
    } catch (error) {
      logger.error('Interactive selection failed', { error });
      console.log('│ ❌ Selection failed - see logs for details              │');
      console.log('└──────────────────────────────────────────────────────────┘\n');

      return {
        strategy: 'or',
        tagQuery: {},
        cancelled: true,
      };
    }
  }

  /**
   * Confirm save operation with preset name
   */
  public async confirmSave(presetName?: string): Promise<{ name: string; description?: string; save: boolean }> {
    if (presetName) {
      // Pre-specified name, just confirm
      const confirm = await prompts({
        type: 'confirm',
        name: 'save',
        message: `Save preset as '${presetName}'?`,
      });

      return {
        name: presetName,
        save: confirm.save || false,
      };
    }

    // Get preset name and optional description
    const nameInput = await prompts({
      type: 'text',
      name: 'name',
      message: 'Enter preset name:',
      validate: (value: string) => {
        if (!value.trim()) {
          return 'Preset name is required';
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
          return 'Preset name can only contain letters, numbers, hyphens, and underscores';
        }
        return true;
      },
    });

    if (!nameInput.name) {
      return { name: '', save: false };
    }

    const descriptionInput = await prompts({
      type: 'text',
      name: 'description',
      message: 'Enter optional description:',
    });

    return {
      name: nameInput.name.trim(),
      description: descriptionInput.description?.trim() || undefined,
      save: true,
    };
  }

  /**
   * Display server configuration for validation
   */
  public displayServerConfig(serverName: string): void {
    const servers = this.mcpConfig.getTransportConfig();
    const config = servers[serverName];

    if (!config) {
      console.log(`Server '${serverName}' not found`);
      return;
    }

    const tags = config.tags || [];
    console.log(`\n📋 Server: ${serverName}`);
    console.log(`   Tags: ${tags.length > 0 ? tags.join(', ') : 'none'}`);
  }

  /**
   * Validate preset name format
   */
  public validatePresetName(name: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(name.trim());
  }

  /**
   * Simple confirmation prompt
   */
  public async confirm(message: string): Promise<boolean> {
    const result = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message,
    });

    return result.confirmed || false;
  }

  /**
   * Show error message
   */
  public showError(message: string): void {
    console.error(`❌ ${message}`);
  }

  /**
   * Show URL result
   */
  public showUrl(name: string, url: string): void {
    console.log(`\n🔗 Preset URL for '${name}':`);
    console.log(`   ${url}\n`);
  }

  /**
   * Show save success message
   */
  public showSaveSuccess(name: string, url: string): void {
    console.log(`\n✅ Preset '${name}' saved successfully!`);
    console.log(`🔗 URL: ${url}\n`);
  }

  /**
   * Test preset and show results
   */
  public async testPreset(name: string, testResult: { servers: string[]; tags: string[] }): Promise<void> {
    console.log(`\n🔍 Testing preset '${name}':`);
    console.log(`   Matching servers: ${testResult.servers.join(', ') || 'none'}`);
    console.log(`   Available tags: ${testResult.tags.join(', ') || 'none'}\n`);
  }
}
