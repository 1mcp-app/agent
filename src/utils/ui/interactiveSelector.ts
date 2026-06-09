import { getAllServerTargets } from '@src/commands/shared/baseConfigUtils.js';
import { MCPServerParams } from '@src/core/types/transport.js';
import { TagQueryEvaluator, TagSelection } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { PresetConfig, PresetStrategy, TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger from '@src/logger/logger.js';

import boxen from 'boxen';
import chalk from 'chalk';
import prompts from 'prompts';

import { confirmPresetSave } from './interactiveSelectorPrompts.js';
import { getInitialTagStateFromQuery, isValidTagQuery } from './interactiveSelectorQuery.js';
import { showTagSelection, showTagServerDetails } from './interactiveSelectorTagUi.js';

export type SelectionResult = { cancelled: true } | { cancelled: false; strategy: PresetStrategy; tagQuery: TagQuery };

/**
 * Result of preset testing
 */
export interface PresetTestResult {
  servers: string[];
  tags: string[];
}

/**
 * Interactive CLI utility for server selection with arrow key navigation
 */
export class InteractiveSelector {
  /**
   * Interactive tag-based selection with strategy configuration and back navigation
   */
  public async selectServers(existingConfig?: Partial<PresetConfig>, configPath?: string): Promise<SelectionResult> {
    // Display welcome message with boxen
    let welcomeContent =
      chalk.magenta.bold('🚀 MCP Preset Configuration\n\n') + chalk.yellow('Configure your preset selection strategy:');

    if (configPath) {
      welcomeContent += '\n\n' + chalk.gray(`📁 Config: ${configPath}`);
    }

    const welcomeMessage = boxen(welcomeContent, {
      padding: 1,
      margin: 1,
      borderStyle: 'double',
      borderColor: 'cyan',
      title: 'Preset Builder',
      titleAlignment: 'center',
    });

    console.log(welcomeMessage);

    try {
      // Get available servers and collect all tags
      const servers = getAllServerTargets();
      if (Object.keys(servers).length === 0) {
        console.log(
          boxen(chalk.red.bold('⚠️  No MCP servers found in configuration'), {
            padding: 1,
            borderStyle: 'round',
            borderColor: 'red',
          }),
        );
        return { cancelled: true };
      }

      // Collect all available tags from all servers
      const allTags = new Set<string>();
      const serverValues = Object.values(servers);
      for (const serverConfig of serverValues) {
        if (serverConfig.tags && Array.isArray(serverConfig.tags)) {
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
        return { cancelled: true };
      }

      // Main interaction loop with back navigation support
      let strategy: PresetStrategy | undefined;
      let tagQuery: TagQuery = {} as TagQuery;
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
          return { cancelled: true };
        }

        strategy = strategySelection.strategy as PresetStrategy;

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
            validate: (value: string): boolean | string => {
              if (typeof value !== 'string') {
                return 'Query must be a string';
              }
              const trimmedValue: string = value.trim();
              if (!trimmedValue) {
                return 'Query cannot be empty';
              }
              try {
                const parsed = JSON.parse(trimmedValue) as unknown;
                // Validate that parsed is a TagQuery before passing to validateQuery
                if (!isValidTagQuery(parsed)) {
                  return 'Invalid query format';
                }
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

          if (queryInput.query === undefined || queryInput.query === null || queryInput.query === '') {
            return { cancelled: true };
          }

          // Ensure queryInput.query is properly typed and not null/undefined
          if (!queryInput.query || typeof queryInput.query !== 'string') {
            throw new Error('Query input is not a valid string');
          }
          const trimmedQuery: string = queryInput.query.trim();
          let parsedQuery: unknown;
          try {
            parsedQuery = JSON.parse(trimmedQuery);
          } catch (parseError) {
            throw new Error(`Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
          }

          // Validate that the parsed query matches TagQuery interface using type guard
          if (isValidTagQuery(parsedQuery)) {
            tagQuery = parsedQuery as TagQuery;
          } else {
            throw new Error('Invalid query format');
          }
          completed = true;
        } else {
          // Step 2: Three-state tag selection with arrow key navigation
          if (strategy) {
            const tagSelectionResult = await this.selectTagsInteractive(
              availableTags,
              servers,
              strategy,
              existingConfig?.tagQuery,
            );

            if (tagSelectionResult.goBack) {
              // User wants to go back to strategy selection
              strategy = undefined;
              continue;
            }

            if (tagSelectionResult.cancelled) {
              return { cancelled: true };
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
        cancelled: false,
        strategy: strategy!,
        tagQuery,
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

      return { cancelled: true };
    }
  }

  /**
   * Confirm save operation with preset name
   */
  public async confirmSave(presetName?: string): Promise<{ name: string; description?: string; save: boolean }> {
    return confirmPresetSave(presetName);
  }

  /**
   * Display server configuration for validation
   */
  public displayServerConfig(serverName: string): void {
    const servers = getAllServerTargets();
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
    const trimmedName: string = name.trim();
    return /^[a-zA-Z0-9_-]+$/.test(trimmedName);
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

    return Boolean(result.confirmed);
  }

  /**
   * Get a numeric choice from user within a range
   */
  public async getChoice(message: string, min: number, max: number): Promise<number> {
    const result = await prompts({
      type: 'number',
      name: 'choice',
      message,
      min,
      max,
      validate: (value: number): boolean | string => {
        if (typeof value !== 'number' || isNaN(value)) {
          return 'Please enter a valid number';
        }
        if (value < min || value > max) {
          return `Please enter a number between ${min} and ${max}`;
        }
        return true;
      },
    });

    return Number(result.choice) || min;
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
  public async testPreset(name: string, testResult: PresetTestResult): Promise<void> {
    console.log(`\n🔍 Testing preset '${name}':`);
    console.log(`   Matching servers: ${testResult.servers.join(', ') || 'none'}`);
    console.log(`   Available tags: ${testResult.tags.join(', ') || 'none'}\n`);
  }

  /**
   * Interactive three-state tag selection with boxen UI and custom keyboard controls
   */
  private async selectTagsInteractive(
    availableTags: string[],
    servers: Record<string, MCPServerParams>,
    strategy: PresetStrategy,
    existingQuery?: TagQuery,
  ): Promise<{
    tagQuery: TagQuery;
    goBack: boolean;
    cancelled: boolean;
  }> {
    // Build tag-to-servers mapping
    const tagServerMap = TagQueryEvaluator.buildTagServerMap(servers);

    // Initialize tag selections with server info and restore from existing query
    const tagSelections: TagSelection[] = availableTags.map((tag) => ({
      tag,
      state: getInitialTagStateFromQuery(tag, existingQuery),
      servers: tagServerMap.get(tag) || [],
    }));

    let currentIndex = 0;

    while (true) {
      // Clear screen
      console.clear();

      // Show main tag selection interface
      showTagSelection(tagSelections, currentIndex, servers, strategy);

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

        case 'right': {
          // Show server details for current tag
          if (currentIndex < tagSelections.length) {
            console.clear();
            showTagServerDetails(tagSelections[currentIndex], servers);
            await this.getKeyInput();
          }
          break;
        }

        case 'enter': {
          // Build final query
          const finalQuery = TagQueryEvaluator.buildQueryFromSelections(tagSelections, strategy);
          return { tagQuery: finalQuery, goBack: false, cancelled: false };
        }

        case 'left':
          return { tagQuery: {} as TagQuery, goBack: true, cancelled: false };

        case 'escape':
          return { tagQuery: {} as TagQuery, goBack: false, cancelled: true };
      }
    }
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

      const onKeypress = (key: string | Buffer): void => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onKeypress);

        // Convert Buffer to string if needed
        let keyStr: string;
        if (Buffer.isBuffer(key)) {
          keyStr = key.toString('utf8');
        } else if (typeof key === 'string') {
          keyStr = key;
        } else {
          keyStr = '';
        }

        // Handle escape sequences for arrow keys
        if (keyStr === '\u001b[A') resolve('up');
        else if (keyStr === '\u001b[B') resolve('down');
        else if (keyStr === '\u001b[D') resolve('left');
        else if (keyStr === '\u001b[C') resolve('right');
        else if (keyStr === ' ') resolve('space');
        else if (keyStr === '\r' || keyStr === '\n') resolve('enter');
        else if (keyStr === '\u001b' || keyStr === '\u0003')
          resolve('escape'); // ESC or Ctrl+C
        else resolve('unknown');
      };

      stdin.on('data', onKeypress);
    });
  }
}
