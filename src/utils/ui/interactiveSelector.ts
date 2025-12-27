import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { MCPServerParams } from '@src/core/types/transport.js';
import { TagQueryEvaluator, TagSelection, TagState } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { PresetConfig, PresetStrategy, TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger from '@src/logger/logger.js';

import boxen from 'boxen';
import chalk from 'chalk';
import prompts from 'prompts';

/**
 * Interactive server selection result
 *
 * Uses discriminated union to prevent invalid states:
 * - Cancelled selections don't have strategy/tagQuery data
 * - Completed selections must have strategy/tagQuery data
 */
export type SelectionResult = { cancelled: true } | { cancelled: false; strategy: PresetStrategy; tagQuery: TagQuery };

/**
 * Result of preset testing
 */
export interface PresetTestResult {
  servers: string[];
  tags: string[];
}

/**
 * Type guard to validate TagQuery objects
 */
function isValidTagQuery(obj: unknown): obj is TagQuery {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const query = obj as Record<string, unknown>;

  // Check for valid properties
  if (query.tag !== undefined && typeof query.tag !== 'string') {
    return false;
  }

  if (query.$or !== undefined && !Array.isArray(query.$or)) {
    return false;
  }

  if (query.$and !== undefined && !Array.isArray(query.$and)) {
    return false;
  }

  if (query.$not !== undefined && !isValidTagQuery(query.$not)) {
    return false;
  }

  if (query.$in !== undefined && !Array.isArray(query.$in)) {
    return false;
  }

  // Recursively validate nested queries in $or and $and
  if (query.$or && Array.isArray(query.$or)) {
    const orArray = query.$or as unknown[];
    if (!orArray.every((item) => isValidTagQuery(item))) {
      return false;
    }
  }

  if (query.$and && Array.isArray(query.$and)) {
    const andArray = query.$and as unknown[];
    if (!andArray.every((item) => isValidTagQuery(item))) {
      return false;
    }
  }

  // Validate $in array contains only strings
  if (query.$in && Array.isArray(query.$in)) {
    const inArray = query.$in as unknown[];
    if (!inArray.every((item: unknown) => typeof item === 'string')) {
      return false;
    }
  }

  return true;
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
      const servers = this.mcpConfig.getTransportConfig();
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
    if (presetName) {
      // Pre-specified name, just confirm
      const confirm = await prompts({
        type: 'confirm',
        name: 'save',
        message: `Save preset as '${presetName}'?`,
      });

      return {
        name: presetName,
        save: Boolean(confirm.save),
      };
    }

    // Get preset name and optional description
    const nameInput = await prompts({
      type: 'text',
      name: 'name',
      message: 'Enter preset name:',
      validate: (value: string): boolean | string => {
        if (typeof value !== 'string') {
          return 'Preset name must be a string';
        }
        const trimmedValue: string = value.trim();
        if (!trimmedValue) {
          return 'Preset name is required';
        }
        if (trimmedValue.length > 50) {
          return 'Preset name must be 50 characters or less';
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmedValue)) {
          return 'Preset name can only contain letters, numbers, hyphens, and underscores';
        }
        return true;
      },
    });

    if (!nameInput.name || nameInput.name === null || nameInput.name === '') {
      return { name: '', save: false };
    }

    const descriptionInput = await prompts({
      type: 'text',
      name: 'description',
      message: 'Enter optional description:',
    });

    // Ensure nameInput.name is properly typed and not null/undefined
    if (!nameInput.name || typeof nameInput.name !== 'string') {
      return { name: '', save: false };
    }
    const trimmedName: string = nameInput.name.trim();

    // Ensure descriptionInput.description is properly typed and safe to process
    let trimmedDescription: string | undefined;
    if (descriptionInput.description && typeof descriptionInput.description === 'string') {
      const descriptionValue = descriptionInput.description;
      if (descriptionValue.trim() !== '') {
        trimmedDescription = descriptionValue.trim();
      }
    }

    return {
      name: trimmedName,
      description: trimmedDescription,
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
      state: this.getInitialTagStateFromQuery(tag, existingQuery, strategy),
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

        case 'right': {
          // Show server details for current tag
          if (currentIndex < tagSelections.length) {
            await this.showTagServerDetails(tagSelections[currentIndex], servers);
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
   * Show main tag selection interface with boxen styling
   */
  private async showTagSelection(
    tagSelections: TagSelection[],
    currentIndex: number,
    servers: Record<string, MCPServerParams>,
    strategy: PresetStrategy,
  ): Promise<void> {
    // Header
    const header = boxen(
      chalk.cyan.bold('🎯 Three-State Tag Selection\n\n') +
        chalk.yellow(`Strategy: ${strategy === 'and' ? 'ALL' : 'ANY'} selected tags must match\n`) +
        chalk.gray('Controls: ↑↓ Navigate  Space Cycle states  → Server details  Enter Confirm  ← Back  Esc Cancel'),
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

        // Count enabled and disabled servers for this tag
        const enabledServers = selection.servers.filter((serverName) => servers[serverName]?.disabled !== true);
        const disabledServers = selection.servers.filter((serverName) => servers[serverName]?.disabled === true);

        let serverInfo = chalk.gray(`(${chalk.blue(enabledServers.length)} enabled`);
        if (disabledServers.length > 0) {
          serverInfo += chalk.gray(`, ${chalk.red(disabledServers.length)} disabled`);
        }
        serverInfo += chalk.gray(')');

        return `${cursor} ${stateColor(symbol)} ${tagHighlight(selection.tag)} ${serverInfo}`;
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

    // Check for disabled servers in the matching set
    const disabledServers = matchingServers.filter((serverName) => servers[serverName]?.disabled === true);
    const enabledServers = matchingServers.filter((serverName) => servers[serverName]?.disabled !== true);

    const matchColor = enabledServers.length === 0 ? chalk.red : enabledServers.length < 3 ? chalk.yellow : chalk.green;
    const matchIcon = enabledServers.length === 0 ? '❌' : enabledServers.length < 3 ? '⚠️' : '✅';

    let previewContent =
      chalk.blue.bold('Live Preview:\n') +
      `${matchIcon} ${matchColor.bold(`${enabledServers.length} enabled servers`)} match your selection\n` +
      (enabledServers.length > 0
        ? chalk.green(`Servers: ${TagQueryEvaluator.formatServerList(enabledServers, 3)}`)
        : chalk.gray('No enabled servers match'));

    // Add warning for disabled servers if any
    if (disabledServers.length > 0) {
      previewContent +=
        '\n' +
        chalk.red.bold(`⚠️  ${disabledServers.length} disabled servers also match: `) +
        chalk.red(TagQueryEvaluator.formatServerList(disabledServers, 3));
    }

    console.log(
      boxen(previewContent, {
        padding: 1,
        borderStyle: 'round',
        borderColor: disabledServers.length > 0 ? 'yellow' : 'green',
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

  /**
   * Get color for tag state
   */
  private getTagStateColor(state: TagState): (text: string) => string {
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

  /**
   * Show detailed information about servers for a specific tag
   */
  private async showTagServerDetails(
    tagSelection: TagSelection,
    servers: Record<string, MCPServerParams>,
  ): Promise<void> {
    console.clear();

    const enabledServers = tagSelection.servers.filter((serverName) => servers[serverName]?.disabled !== true);
    const disabledServers = tagSelection.servers.filter((serverName) => servers[serverName]?.disabled === true);

    let content = chalk.blue.bold(`📋 Tag: ${tagSelection.tag}\n\n`);

    if (enabledServers.length > 0) {
      content += chalk.green.bold(`✅ Enabled Servers (${enabledServers.length}):\n`);
      for (const serverName of enabledServers) {
        const serverConfig = servers[serverName];
        const allTags = (serverConfig.tags || []).join(', ');
        content += chalk.green(`  • ${serverName}`) + chalk.gray(` - tags: ${allTags || 'none'}\n`);
      }
      content += '\n';
    }

    if (disabledServers.length > 0) {
      content += chalk.red.bold(`❌ Disabled Servers (${disabledServers.length}):\n`);
      for (const serverName of disabledServers) {
        const serverConfig = servers[serverName];
        const allTags = (serverConfig.tags || []).join(', ');
        content += chalk.red(`  • ${serverName}`) + chalk.gray(` - tags: ${allTags || 'none'}\n`);
      }
      content += '\n';
    }

    if (tagSelection.servers.length === 0) {
      content += chalk.yellow('No servers have this tag.\n\n');
    }

    content += chalk.gray('Press any key to return to tag selection...');

    console.log(
      boxen(content, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'blue',
        title: `🔍 Server Details`,
        titleAlignment: 'center',
      }),
    );

    // Wait for any key press
    await this.getKeyInput();
  }

  /**
   * Determine initial tag state from existing query
   */
  private getInitialTagStateFromQuery(tag: string, existingQuery?: TagQuery, _strategy?: PresetStrategy): TagState {
    if (!existingQuery || !isValidTagQuery(existingQuery)) {
      return 'empty';
    }

    // Helper function to recursively check if a query matches a tag
    const queryMatches = (query: unknown): boolean => {
      if (!isValidTagQuery(query)) {
        return false;
      }

      // Use the query directly since it's been validated
      const validQuery = query as TagQuery;

      // Direct tag match
      if (validQuery.tag === tag) {
        return true;
      }

      // Check nested $or
      if (validQuery.$or && Array.isArray(validQuery.$or)) {
        return validQuery.$or.some((subQuery: unknown) => queryMatches(subQuery));
      }

      // Check nested $and
      if (validQuery.$and && Array.isArray(validQuery.$and)) {
        return validQuery.$and.some((subQuery: unknown) => queryMatches(subQuery));
      }

      // Check $in operator
      if (validQuery.$in && Array.isArray(validQuery.$in)) {
        const inArray = validQuery.$in as unknown[];
        return inArray.some((item): item is string => typeof item === 'string' && item === tag);
      }

      // Check $not operator recursively
      if (validQuery.$not) {
        return queryMatches(validQuery.$not);
      }

      return false;
    };

    // Helper function to check for NOT conditions
    const queryMatchesNot = (query: unknown): boolean => {
      if (!isValidTagQuery(query)) {
        return false;
      }

      // Use the query directly since it's been validated
      const validQuery = query as TagQuery;

      // Direct NOT match
      if (validQuery.$not) {
        return queryMatches(validQuery.$not);
      }

      // Check for NOT in nested structures
      if (validQuery.$and && Array.isArray(validQuery.$and)) {
        return validQuery.$and.some((subQuery: unknown) => {
          if (!isValidTagQuery(subQuery)) return false;
          const subQueryTyped = subQuery as TagQuery;
          return subQueryTyped.$not && queryMatches(subQueryTyped.$not);
        });
      }

      // Check for NOT in $or structures as well
      if (validQuery.$or && Array.isArray(validQuery.$or)) {
        return validQuery.$or.some((subQuery: unknown) => {
          if (!isValidTagQuery(subQuery)) return false;
          const subQueryTyped = subQuery as TagQuery;
          return subQueryTyped.$not && queryMatches(subQueryTyped.$not);
        });
      }

      return false;
    };

    // Check for NOT conditions first (they take precedence)
    if (queryMatchesNot(existingQuery)) {
      return 'not-selected';
    }

    // Check for positive matches
    if (queryMatches(existingQuery)) {
      return 'selected';
    }

    return 'empty';
  }
}
