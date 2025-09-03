import prompts from 'prompts';
import boxen from 'boxen';
import chalk from 'chalk';
import { McpConfigManager } from '../config/mcpConfigManager.js';
import { PresetStrategy, PresetConfig, TagQuery } from './presetTypes.js';
import { TagQueryEvaluator, TagSelection, TagState } from './tagQueryEvaluator.js';
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
    // Display welcome message with boxen
    const welcomeMessage = boxen(
      chalk.magenta.bold('🚀 MCP Preset Configuration\n\n') + chalk.yellow('Configure your preset selection strategy:'),
      {
        padding: 1,
        margin: 1,
        borderStyle: 'double',
        borderColor: 'cyan',
        title: 'Preset Builder',
        titleAlignment: 'center',
      },
    );

    console.log(welcomeMessage);

    try {
      // Get available servers and collect all tags
      const servers = this.mcpConfig.getTransportConfig();
      if (Object.keys(servers).length === 0) {
        console.log(
          boxen(chalk.red.bold('⚠️  No MCP servers found in configuration'), {
            padding: 1,
            borderStyle: 'round',
            borderColor: 'red',
          }),
        );
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
        console.log(
          boxen(chalk.red.bold('⚠️  No tags found in server configuration'), {
            padding: 1,
            borderStyle: 'round',
            borderColor: 'red',
          }),
        );
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
          console.log(
            boxen(chalk.magenta.bold('📝 Custom Query Input'), {
              padding: 1,
              borderStyle: 'round',
              borderColor: 'magenta',
            }),
          );

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
            return {
              strategy: 'or',
              tagQuery: {},
              cancelled: true,
            };
          }

          tagQuery = JSON.parse(queryInput.query.trim());
          completed = true;
        } else {
          // Step 2: Three-state tag selection with arrow key navigation
          if (strategy) {
            const tagSelectionResult = await this.selectTagsInteractive(availableTags, servers, strategy);

            if (tagSelectionResult.goBack) {
              // User wants to go back to strategy selection
              strategy = undefined;
              continue;
            }

            if (tagSelectionResult.cancelled) {
              return {
                strategy: 'or',
                tagQuery: {},
                cancelled: true,
              };
            }

            tagQuery = tagSelectionResult.tagQuery;
            completed = true;
          }
        }

        // Step 3: Preview and confirmation
        if (completed) {
          const queryString = TagQueryEvaluator.queryToString(tagQuery);

          // Show matching servers
          const matchingServers = Object.entries(servers)
            .filter(([, serverConfig]) => {
              const serverTags = serverConfig.tags || [];
              return TagQueryEvaluator.evaluate(tagQuery, serverTags);
            })
            .map(([serverName]) => serverName);

          const serverList = matchingServers.slice(0, 3).join(', ');
          const moreText = matchingServers.length > 3 ? `... and ${matchingServers.length - 3} more` : '';

          const previewContent =
            chalk.yellow.bold('Preview query: ') +
            chalk.green(queryString) +
            '\n\n' +
            chalk.yellow.bold(`Matching servers (${matchingServers.length}): `) +
            chalk.green(serverList) +
            (moreText ? '\n' + chalk.gray(moreText) : '');

          console.log(
            boxen(previewContent, {
              padding: 1,
              borderStyle: 'round',
              borderColor: 'green',
              title: '✅ Query Preview',
              titleAlignment: 'center',
            }),
          );
        }
      }

      return {
        strategy: strategy!,
        tagQuery,
        cancelled: false,
      };
    } catch (error) {
      logger.error('Interactive selection failed', { error });
      console.log(
        boxen(chalk.red.bold('❌ Selection failed - see logs for details'), {
          padding: 1,
          borderStyle: 'round',
          borderColor: 'red',
        }),
      );

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
        if (value.trim().length > 50) {
          return 'Preset name must be 50 characters or less';
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

  /**
   * Interactive three-state tag selection with boxen UI and custom keyboard controls
   */
  private async selectTagsInteractive(
    availableTags: string[],
    servers: Record<string, any>,
    strategy: PresetStrategy,
  ): Promise<{
    tagQuery: TagQuery;
    goBack: boolean;
    cancelled: boolean;
  }> {
    // Build tag-to-servers mapping
    const tagServerMap = TagQueryEvaluator.buildTagServerMap(servers);

    // Initialize tag selections with server info
    const tagSelections: TagSelection[] = availableTags.map((tag) => ({
      tag,
      state: 'empty' as TagState,
      servers: tagServerMap.get(tag) || [],
    }));

    let currentIndex = 0;

    while (true) {
      // Clear screen
      console.clear();

      // Show main tag selection interface
      await this.showTagSelection(tagSelections, currentIndex, servers, strategy);

      // Get user input
      const action = await this.getKeyInput();

      // Main tag selection view
      switch (action) {
        case 'up':
          currentIndex = Math.max(0, currentIndex - 1);
          break;

        case 'down':
          currentIndex = Math.min(tagSelections.length - 1, currentIndex + 1);
          break;

        case 'space':
          if (currentIndex < tagSelections.length) {
            tagSelections[currentIndex].state = TagQueryEvaluator.cycleTagState(tagSelections[currentIndex].state);
          }
          break;

        case 'right':
        case 'enter': {
          // Build final query
          const finalQuery = TagQueryEvaluator.buildQueryFromSelections(tagSelections, strategy);
          return { tagQuery: finalQuery, goBack: false, cancelled: false };
        }

        case 'left':
          return { tagQuery: {}, goBack: true, cancelled: false };

        case 'escape':
          return { tagQuery: {}, goBack: false, cancelled: true };
      }
    }
  }

  /**
   * Show main tag selection interface with boxen styling
   */
  private async showTagSelection(
    tagSelections: TagSelection[],
    currentIndex: number,
    servers: Record<string, any>,
    strategy: PresetStrategy,
  ): Promise<void> {
    // Header
    const header = boxen(
      chalk.cyan.bold('🎯 Three-State Tag Selection\n\n') +
        chalk.yellow(`Strategy: ${strategy === 'and' ? 'ALL' : 'ANY'} selected tags must match\n`) +
        chalk.gray('Controls: ↑↓ Navigate  Space Cycle states  →/Enter Confirm  ← Back  Esc Cancel'),
      {
        padding: 1,
        borderStyle: 'double',
        borderColor: 'cyan',
        title: 'Tag Selection',
        titleAlignment: 'center',
      },
    );
    console.log(header);

    // Tag list
    const tagListContent = tagSelections
      .map((selection, index) => {
        const symbol = TagQueryEvaluator.getTagStateSymbol(selection.state);
        const stateColor = this.getTagStateColor(selection.state);
        const isCurrentIndex = index === currentIndex;

        const cursor = isCurrentIndex ? chalk.yellow.bold('►') : ' ';
        const tagHighlight = isCurrentIndex ? chalk.bgGray.white.bold : chalk.white;
        const serverCount = chalk.gray(`(${chalk.blue(selection.servers.length)} servers)`);

        return `${cursor} ${stateColor(symbol)} ${tagHighlight(selection.tag)} ${serverCount}`;
      })
      .join('\n');

    console.log(
      boxen(tagListContent, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'blue',
      }),
    );

    // Live preview
    const matchingServers = TagQueryEvaluator.getMatchingServers(tagSelections, servers, strategy);
    const serverPreview = TagQueryEvaluator.formatServerList(matchingServers, 3);

    const matchColor =
      matchingServers.length === 0 ? chalk.red : matchingServers.length < 3 ? chalk.yellow : chalk.green;
    const matchIcon = matchingServers.length === 0 ? '❌' : matchingServers.length < 3 ? '⚠️' : '✅';

    const previewContent =
      chalk.blue.bold('Live Preview:\n') +
      `${matchIcon} ${matchColor.bold(`${matchingServers.length} servers`)} match your selection\n` +
      (matchingServers.length > 0 ? chalk.green(`Servers: ${serverPreview}`) : chalk.gray('No servers match'));

    console.log(
      boxen(previewContent, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'green',
        title: '⚡ Live Preview',
        titleAlignment: 'center',
      }),
    );

    // State legend
    const legend =
      chalk.gray('○ ') +
      chalk.dim('Empty (ignored)') +
      '   ' +
      chalk.green('✓ ') +
      chalk.green('Selected (include)') +
      '   ' +
      chalk.red('✗ ') +
      chalk.red('Not selected (exclude)');

    console.log(
      boxen(legend, {
        padding: 1,
        borderStyle: 'single',
        borderColor: 'gray',
      }),
    );
  }

  /**
   * Get single key input with proper handling for arrow keys
   */
  private async getKeyInput(): Promise<string> {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const onKeypress = (key: string) => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onKeypress);

        // Handle escape sequences for arrow keys
        if (key === '\u001b[A') resolve('up');
        else if (key === '\u001b[B') resolve('down');
        else if (key === '\u001b[D') resolve('left');
        else if (key === '\u001b[C') resolve('right');
        else if (key === ' ') resolve('space');
        else if (key === '\r' || key === '\n') resolve('enter');
        else if (key === '\u001b' || key === '\u0003')
          resolve('escape'); // ESC or Ctrl+C
        else resolve('unknown');
      };

      stdin.on('data', onKeypress);
    });
  }

  /**
   * Get color for tag state
   */
  private getTagStateColor(state: TagState): typeof chalk {
    switch (state) {
      case 'empty':
        return chalk.gray;
      case 'selected':
        return chalk.green;
      case 'not-selected':
        return chalk.red;
      default:
        return chalk.reset;
    }
  }
}
