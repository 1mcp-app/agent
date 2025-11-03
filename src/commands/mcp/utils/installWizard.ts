import { MCPRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import { RegistryServer } from '@src/domains/registry/types.js';
import logger from '@src/logger/logger.js';

import boxen from 'boxen';
import chalk from 'chalk';
import prompts from 'prompts';

/**
 * Configuration result from the interactive wizard
 */
export interface WizardInstallConfig {
  serverId: string;
  version?: string;
  localName?: string;
  tags?: string[];
  env?: Record<string, string>;
  args?: string[];
  installAnother: boolean;
  cancelled: boolean;
  forceOverride?: boolean;
}

/**
 * Interactive installation wizard for MCP servers
 */
export class InstallWizard {
  private registryClient: MCPRegistryClient;

  constructor(registryClient: MCPRegistryClient) {
    this.registryClient = registryClient;
  }

  /**
   * Run the complete interactive installation wizard
   */
  async run(initialServerId?: string, existingServerNames: string[] = []): Promise<WizardInstallConfig> {
    try {
      // Show welcome screen with controls
      this.showWelcome();

      let serverId = initialServerId;
      let selectedServer: RegistryServer | undefined;

      // Step 1: Get server (search or use provided ID)
      if (!serverId) {
        const searchResult = await this.searchServers();
        if (searchResult.cancelled) {
          return this.cancelledResult();
        }
        serverId = searchResult.serverId;
        selectedServer = searchResult.server;
      } else {
        // Confirm provided server ID
        const confirmed = await this.confirmServerId(serverId);
        if (!confirmed) {
          return this.cancelledResult();
        }
        // Fetch server details
        try {
          selectedServer = await this.registryClient.getServerById(serverId);
        } catch (error) {
          logger.error('Failed to fetch server details', { serverId, error });
          console.log(
            boxen(chalk.red.bold(`❌ Server '${serverId}' not found in registry`), {
              padding: 1,
              borderStyle: 'round',
              borderColor: 'red',
            }),
          );
          return this.cancelledResult();
        }
      }

      if (!selectedServer) {
        return this.cancelledResult();
      }

      // Step 2: Configuration prompts
      let config = await this.collectConfiguration(selectedServer, existingServerNames);
      if (config.cancelled) {
        return this.cancelledResult();
      }

      // Step 3: Confirmation summary (with back navigation)
      while (true) {
        const confirmed = await this.showConfirmation(selectedServer, config);

        if (confirmed === 'back') {
          // Go back to configuration step
          const newConfig = await this.collectConfiguration(selectedServer, existingServerNames);
          if (newConfig.cancelled) {
            return this.cancelledResult();
          }
          config = newConfig;
          continue; // Show confirmation again with new config
        }

        if (!confirmed) {
          return this.cancelledResult();
        }

        // Confirmed - proceed to next step
        break;
      }

      // Step 4: Ask to install another
      const installAnother = await this.askInstallAnother();

      // If not installing another, cleanup now
      if (!installAnother) {
        this.cleanup();
      }

      return {
        serverId: selectedServer.name,
        version: config.version,
        localName: config.localName,
        tags: config.tags,
        env: config.env,
        args: config.args,
        installAnother,
        cancelled: false,
        forceOverride: config.forceOverride,
      };
    } catch (error) {
      logger.error('Wizard failed', { error });
      console.log(
        boxen(chalk.red.bold('❌ Installation wizard failed - see logs for details'), {
          padding: 1,
          borderStyle: 'round',
          borderColor: 'red',
        }),
      );
      this.cleanup();
      return this.cancelledResult();
    }
  }

  /**
   * Show welcome screen with key bindings
   */
  private showWelcome(): void {
    const welcomeContent =
      chalk.magenta.bold('🚀 MCP Server Installation Wizard\n\n') +
      chalk.yellow('This wizard will guide you through installing an MCP server.\n\n') +
      chalk.cyan.bold('Navigation Keys:\n') +
      chalk.gray('  ↑/↓     - Navigate options\n') +
      chalk.gray('  ←       - Go back\n') +
      chalk.gray('  →       - View details\n') +
      chalk.gray('  Tab     - Next step\n') +
      chalk.gray('  Enter   - Confirm\n') +
      chalk.gray('  Ctrl+C  - Cancel');

    console.log(
      boxen(welcomeContent, {
        padding: 1,
        margin: 1,
        borderStyle: 'double',
        borderColor: 'cyan',
        title: 'Install Wizard',
        titleAlignment: 'center',
      }),
    );
  }

  /**
   * Show step indicator
   */
  private showStepIndicator(currentStep: number, _totalSteps: number, _stepName: string): void {
    const steps = ['Search', 'Select', 'Configure', 'Confirm', 'Install'];
    const stepBar = steps
      .map((step, index) => {
        const num = index + 1;
        if (num < currentStep) {
          return chalk.green(`✓ ${step}`);
        } else if (num === currentStep) {
          return chalk.cyan.bold(`► ${step}`);
        } else {
          return chalk.gray(`○ ${step}`);
        }
      })
      .join(chalk.gray(' → '));

    console.log(
      boxen(stepBar, {
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        borderStyle: 'single',
        borderColor: 'gray',
      }),
    );
    console.log('');
  }

  /**
   * Search for servers interactively
   */
  private async searchServers(): Promise<{
    serverId: string;
    server?: RegistryServer;
    cancelled: boolean;
  }> {
    let searchTerm = '';
    let searchResults: RegistryServer[] = [];

    while (true) {
      // Show step indicator
      console.clear();
      this.showStepIndicator(1, 5, 'Search');

      // Get search term
      const searchInput = await prompts({
        type: 'text',
        name: 'query',
        message: 'Enter server name to search:',
        initial: searchTerm,
        validate: (value: string) => {
          if (!value || typeof value !== 'string' || value.trim().length === 0) {
            return 'Search term cannot be empty';
          }
          return true;
        },
      });

      if (!searchInput.query || searchInput.query === '') {
        return { serverId: '', cancelled: true };
      }

      searchTerm = String(searchInput.query).trim();

      // Perform search
      console.log(chalk.cyan(`\n🔍 Searching for "${searchTerm}"...\n`));

      try {
        searchResults = await this.registryClient.searchServers({
          query: searchTerm,
          limit: 20,
        });

        if (searchResults.length === 0) {
          console.log(
            boxen(chalk.yellow.bold('⚠️  No servers found matching your search'), {
              padding: 1,
              borderStyle: 'round',
              borderColor: 'yellow',
            }),
          );

          const retry = await prompts({
            type: 'confirm',
            name: 'continue',
            message: 'Try another search?',
            initial: true,
          });

          if (!retry.continue) {
            return { serverId: '', cancelled: true };
          }
          continue;
        }

        // Show results and let user select
        const selection = await this.selectFromResults(searchResults);
        if (selection.cancelled) {
          return { serverId: '', cancelled: true };
        }
        if (selection.goBack) {
          continue; // Refine search
        }

        return {
          serverId: selection.server!.name,
          server: selection.server,
          cancelled: false,
        };
      } catch (error) {
        logger.error('Search failed', { searchTerm, error });
        console.log(
          boxen(chalk.red.bold('❌ Search failed - please try again'), {
            padding: 1,
            borderStyle: 'round',
            borderColor: 'red',
          }),
        );

        const retry = await prompts({
          type: 'confirm',
          name: 'continue',
          message: 'Try again?',
          initial: true,
        });

        if (!retry.continue) {
          return { serverId: '', cancelled: true };
        }
      }
    }
  }

  /**
   * Select a server from search results with arrow key navigation
   */
  private async selectFromResults(
    results: RegistryServer[],
  ): Promise<{ server?: RegistryServer; goBack: boolean; cancelled: boolean }> {
    let currentIndex = 0;
    let showingDetails = false;

    while (true) {
      console.clear();

      if (showingDetails) {
        // Show detail view
        await this.showServerDetails(results[currentIndex]);
        showingDetails = false;
        continue;
      }

      // Show results list
      this.renderResultsList(results, currentIndex);

      // Get key input
      const action = await this.getKeyInput();

      switch (action) {
        case 'up':
          currentIndex = Math.max(0, currentIndex - 1);
          break;

        case 'down':
          currentIndex = Math.min(results.length - 1, currentIndex + 1);
          break;

        case 'right':
          showingDetails = true;
          break;

        case 'left':
          return { goBack: true, cancelled: false };

        case 'enter':
          return { server: results[currentIndex], goBack: false, cancelled: false };

        case 'escape':
          return { cancelled: true, goBack: false };
      }
    }
  }

  /**
   * Render the results list with highlighted selection
   */
  private renderResultsList(results: RegistryServer[], currentIndex: number): void {
    this.showStepIndicator(2, 5, 'Select');

    const header = boxen(
      chalk.cyan.bold(`📦 Search Results (${results.length} found)\n\n`) +
        chalk.gray('Controls: ↑↓ Navigate  → Details  Enter Select  ← Back  Esc Cancel'),
      {
        padding: 1,
        borderStyle: 'double',
        borderColor: 'cyan',
        title: 'Select Server',
        titleAlignment: 'center',
      },
    );
    console.log(header);

    const listContent = results
      .map((server, index) => {
        const isSelected = index === currentIndex;
        const cursor = isSelected ? chalk.yellow.bold('►') : ' ';
        const nameStyle = isSelected ? chalk.bgGray.white.bold : chalk.white;
        const description = server.description?.substring(0, 60) || 'No description';
        const descStyle = isSelected ? chalk.gray : chalk.dim;

        return `${cursor} ${nameStyle(server.name)}\n  ${descStyle(description)}`;
      })
      .join('\n\n');

    console.log(
      boxen(listContent, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'blue',
      }),
    );
  }

  /**
   * Show detailed information about a server
   */
  private async showServerDetails(server: RegistryServer): Promise<void> {
    const content =
      chalk.blue.bold(`📋 ${server.name}\n\n`) +
      chalk.yellow.bold('Description:\n') +
      chalk.white(`${server.description || 'No description available'}\n\n`) +
      (server.websiteUrl ? chalk.yellow.bold('Website:\n') + chalk.cyan(`${server.websiteUrl}\n\n`) : '') +
      (server.repository?.url ? chalk.yellow.bold('Repository:\n') + chalk.cyan(`${server.repository.url}\n\n`) : '') +
      chalk.gray('Press any key to return...');

    console.log(
      boxen(content, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'blue',
        title: '🔍 Server Details',
        titleAlignment: 'center',
      }),
    );

    await this.getKeyInput();
  }

  /**
   * Confirm a provided server ID
   */
  private async confirmServerId(serverId: string): Promise<boolean> {
    const result = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: `Install server '${chalk.cyan(serverId)}'?`,
      initial: true,
    });

    return Boolean(result.confirmed);
  }

  /**
   * Collect configuration (tags, env, args)
   */
  private async collectConfiguration(
    server: RegistryServer,
    existingNames: string[] = [],
  ): Promise<{
    version?: string;
    localName?: string;
    tags?: string[];
    env?: Record<string, string>;
    args?: string[];
    cancelled: boolean;
    goBack?: boolean;
    forceOverride?: boolean;
  }> {
    console.clear();
    this.showStepIndicator(3, 5, 'Configure');

    console.log(
      boxen(chalk.magenta.bold(`⚙️  Configure: ${server.name}`), {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'magenta',
      }),
    );

    // Derive auto-generated name
    const autoGeneratedName = this.deriveLocalName(server.name);

    // Local name with conflict detection
    let localName = autoGeneratedName;
    let nameConflict = existingNames.includes(localName);
    let forceOverride = false;

    while (true) {
      const localNameInput = await prompts({
        type: 'text',
        name: 'localName',
        message: nameConflict
          ? chalk.yellow(`⚠️  Server '${localName}' already exists. Enter a different name:`)
          : `Local server name:`,
        initial: localName,
      });

      if (localNameInput.localName === undefined) {
        return { cancelled: true };
      }

      localName = String(localNameInput.localName).trim();

      // Check for conflict
      if (existingNames.includes(localName)) {
        nameConflict = true;

        // Ask user what to do
        const conflictAction = await prompts({
          type: 'select',
          name: 'action',
          message: `Server '${localName}' already exists. What would you like to do?`,
          choices: [
            { title: 'Rename (enter a different name)', value: 'rename' },
            { title: 'Override (replace existing server)', value: 'override' },
            { title: 'Cancel installation', value: 'cancel' },
          ],
          initial: 0,
        });

        if (conflictAction.action === 'cancel' || conflictAction.action === undefined) {
          return { cancelled: true };
        }

        if (conflictAction.action === 'override') {
          // User wants to override - set flag and break the loop
          forceOverride = true;
          break;
        }

        // If 'rename', loop continues with nameConflict still true
        continue;
      }

      // No conflict, proceed
      break;
    }

    // Tags - default to server name
    const defaultTags = autoGeneratedName;
    const tagsInput = await prompts({
      type: 'text',
      name: 'tags',
      message: 'Tags (comma-separated):',
      initial: defaultTags,
    });

    if (tagsInput.tags === undefined) {
      return { cancelled: true };
    }

    // Configure environment variables interactively
    const env = await this.configureEnvVars(server);
    if (env === null) {
      return { cancelled: true };
    }

    // Configure arguments interactively
    const args = await this.configureArgs(server);
    if (args === null) {
      return { cancelled: true };
    }

    const tagsValue = String(tagsInput.tags || '').trim();
    const tags = tagsValue
      ? tagsValue
          .split(',')
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0)
      : undefined;

    return {
      localName: localName || undefined,
      tags,
      env: env || undefined,
      args: args || undefined,
      cancelled: false,
      forceOverride,
    };
  }

  /**
   * Configure environment variables interactively
   */
  private async configureEnvVars(server: RegistryServer): Promise<Record<string, string> | null> {
    const envVarMetadata = this.extractEnvVarMetadata(server);

    if (envVarMetadata.length === 0) {
      // No env vars defined, ask if user wants to add any manually
      const addManual = await prompts({
        type: 'confirm',
        name: 'add',
        message: 'No environment variables defined. Add any manually?',
        initial: false,
      });

      if (addManual.add === undefined) {
        return null;
      }

      if (!addManual.add) {
        return {};
      }

      // Allow manual JSON input
      const manualInput = await prompts({
        type: 'text',
        name: 'env',
        message: 'Environment variables (JSON):',
        initial: '{}',
        validate: (value: string) => {
          try {
            JSON.parse(value);
            return true;
          } catch {
            return 'Invalid JSON format';
          }
        },
      });

      if (manualInput.env === undefined) {
        return null;
      }

      return JSON.parse(String(manualInput.env)) as Record<string, string>;
    }

    // Show summary of available env vars
    console.log(chalk.cyan.bold('\n📋 Available Environment Variables:'));
    console.log(chalk.gray(`   Found ${envVarMetadata.length} environment variables\n`));

    // Ask if user wants to configure any
    const wantsToConfigure = await prompts({
      type: 'confirm',
      name: 'value',
      message: `Configure environment variables?`,
      initial: envVarMetadata.some((v) => v.isRequired),
    });

    if (wantsToConfigure.value === undefined) {
      return null;
    }

    if (!wantsToConfigure.value) {
      // Use defaults only for required vars
      const env: Record<string, string> = {};
      envVarMetadata.forEach((envVar) => {
        if (envVar.default && envVar.isRequired) {
          env[envVar.key] = envVar.default;
        }
      });
      return env;
    }

    // Let user select which env vars to configure
    const choices = envVarMetadata.map((envVar) => {
      const required = envVar.isRequired ? chalk.red('*required') : '';
      const secret = envVar.isSecret ? chalk.yellow('🔒 ') : '';
      const title = `${secret}${envVar.key} ${required}`;
      const description = envVar.description || '';
      return {
        title,
        description,
        value: envVar.key,
        selected: envVar.isRequired || false, // Pre-select required vars
      };
    });

    const selection = await prompts({
      type: 'multiselect',
      name: 'selected',
      message: 'Select environment variables to configure (use space to select, enter to confirm):',
      choices,
      hint: '- Space to select. Enter to submit',
      instructions: false,
    });

    if (selection.selected === undefined) {
      return null;
    }

    const selectedKeys = selection.selected as string[];
    if (selectedKeys.length === 0) {
      return {};
    }

    // Prompt for each selected env var
    console.log(chalk.cyan.bold('\n📝 Configure Selected Variables:\n'));
    const env: Record<string, string> = {};

    for (const key of selectedKeys) {
      const envVar = envVarMetadata.find((v) => v.key === key);
      if (!envVar) continue;

      const result = await prompts({
        type: envVar.isSecret ? 'password' : 'text',
        name: 'value',
        message: `${envVar.key}${envVar.isRequired ? chalk.red(' *') : ''}:${envVar.description ? `\n   ${chalk.gray(envVar.description)}` : ''}`,
        initial: envVar.default || '',
      });

      if (result.value === undefined) {
        // User can skip by pressing Ctrl+C on individual fields
        continue;
      }

      const value = String(result.value).trim();
      if (value) {
        env[envVar.key] = value;
      } else if (envVar.isRequired) {
        console.log(chalk.yellow(`⚠️  ${envVar.key} is required, using default or empty value`));
        env[envVar.key] = envVar.default || '';
      }
    }

    return env;
  }

  /**
   * Configure runtime arguments interactively
   */
  private async configureArgs(server: RegistryServer): Promise<string[] | null> {
    const argMetadata = this.extractArgMetadata(server);

    if (argMetadata.length === 0) {
      // No args defined, ask if user wants to add any manually
      const addManual = await prompts({
        type: 'confirm',
        name: 'add',
        message: 'No runtime arguments defined. Add any manually?',
        initial: false,
      });

      if (addManual.add === undefined) {
        return null;
      }

      if (!addManual.add) {
        return [];
      }

      // Allow manual input
      const manualInput = await prompts({
        type: 'text',
        name: 'args',
        message: 'Arguments (comma-separated):',
        initial: '',
      });

      if (manualInput.args === undefined) {
        return null;
      }

      const argsValue = String(manualInput.args).trim();
      return argsValue
        ? argsValue
            .split(',')
            .map((a: string) => a.trim())
            .filter((a: string) => a.length > 0)
        : [];
    }

    // Show summary of available args
    console.log(chalk.cyan.bold('\n⚙️  Available Runtime Arguments:'));
    console.log(chalk.gray(`   Found ${argMetadata.length} runtime arguments\n`));

    // Ask if user wants to configure any
    const wantsToConfigure = await prompts({
      type: 'confirm',
      name: 'value',
      message: `Configure runtime arguments?`,
      initial: argMetadata.some((a) => a.isRequired),
    });

    if (wantsToConfigure.value === undefined) {
      return null;
    }

    if (!wantsToConfigure.value) {
      // Use defaults only for required args
      return argMetadata.filter((a) => a.isRequired && a.default).map((a) => `${a.name}=${a.default}`);
    }

    // Let user select which args to configure
    const choices = argMetadata.map((arg) => {
      const required = arg.isRequired ? chalk.red('*required') : '';
      const name = arg.name || 'argument';
      const title = `${name} ${required}`;
      const description = arg.description || '';
      return {
        title,
        description,
        value: arg.name || '',
        selected: arg.isRequired || false, // Pre-select required args
      };
    });

    const selection = await prompts({
      type: 'multiselect',
      name: 'selected',
      message: 'Select runtime arguments to configure (use space to select, enter to confirm):',
      choices,
      hint: '- Space to select. Enter to submit',
      instructions: false,
    });

    if (selection.selected === undefined) {
      return null;
    }

    const selectedNames = selection.selected as string[];
    if (selectedNames.length === 0) {
      return [];
    }

    // Prompt for each selected arg
    console.log(chalk.cyan.bold('\n📝 Configure Selected Arguments:\n'));
    const args: string[] = [];

    for (const name of selectedNames) {
      const arg = argMetadata.find((a) => a.name === name);
      if (!arg) continue;

      let result;
      if (arg.choices && arg.choices.length > 0) {
        result = await prompts({
          type: 'select',
          name: 'value',
          message: `${arg.name || 'Argument'}${arg.isRequired ? chalk.red(' *') : ''}:${arg.description ? `\n   ${chalk.gray(arg.description)}` : ''}`,
          choices: arg.choices.map((c) => ({ title: c, value: c })),
          initial: arg.default ? arg.choices.indexOf(arg.default) : 0,
        });
      } else {
        result = await prompts({
          type: 'text',
          name: 'value',
          message: `${arg.name || 'Argument'}${arg.isRequired ? chalk.red(' *') : ''}:${arg.description ? `\n   ${chalk.gray(arg.description)}` : ''}`,
          initial: arg.default || '',
        });
      }

      if (result.value === undefined) {
        // User can skip by pressing Ctrl+C on individual fields
        continue;
      }

      const value = String(result.value).trim();
      if (value) {
        // Format as name=value for CLI args
        args.push(`${arg.name}=${value}`);
      } else if (arg.isRequired && arg.default) {
        console.log(chalk.yellow(`⚠️  ${arg.name} is required, using default value`));
        args.push(`${arg.name}=${arg.default}`);
      }
    }

    return args;
  }

  /**
   * Derive local server name from registry ID
   */
  private deriveLocalName(registryId: string): string {
    // Extract the last part after the slash, or use the full ID if no slash
    const lastPart = registryId.includes('/') ? registryId.split('/').pop()! : registryId;

    // If it already starts with a letter and only contains valid chars, use it as-is
    const localNameRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    if (localNameRegex.test(lastPart) && lastPart.length <= 50) {
      return lastPart;
    }

    // Otherwise, sanitize it
    let sanitized = lastPart.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Ensure it starts with a letter
    if (!/^[a-zA-Z]/.test(sanitized)) {
      sanitized = `server_${sanitized}`;
    }

    // Truncate to 50 characters if longer
    if (sanitized.length > 50) {
      sanitized = sanitized.substring(0, 50);
    }

    // Ensure it's not empty after sanitization
    if (sanitized.length === 0) {
      sanitized = 'server';
    }

    return sanitized;
  }

  /**
   * Extract all environment variables with metadata from server
   */
  private extractEnvVarMetadata(server: RegistryServer): Array<{
    key: string;
    description?: string;
    default?: string;
    isRequired?: boolean;
    isSecret?: boolean;
  }> {
    const envVars: Array<{
      key: string;
      description?: string;
      default?: string;
      isRequired?: boolean;
      isSecret?: boolean;
    }> = [];
    const seen = new Set<string>();

    if (server.packages && server.packages.length > 0) {
      for (const pkg of server.packages) {
        if (pkg.environmentVariables && Array.isArray(pkg.environmentVariables)) {
          for (const envVar of pkg.environmentVariables) {
            // Use 'name' or 'value' field for the environment variable key
            const key = envVar.name || envVar.value;
            if (key && !seen.has(key)) {
              seen.add(key);
              envVars.push({
                key,
                description: envVar.description,
                default: envVar.default,
                isRequired: envVar.isRequired,
                isSecret: envVar.isSecret,
              });
            }
          }
        }
      }
    }

    return envVars;
  }

  /**
   * Extract default environment variables from server metadata
   */
  private extractDefaultEnvVars(server: RegistryServer): Record<string, string> {
    const envVars: Record<string, string> = {};

    // Check packages for environment variables
    if (server.packages && server.packages.length > 0) {
      for (const pkg of server.packages) {
        if (pkg.environmentVariables && Array.isArray(pkg.environmentVariables)) {
          for (const envVar of pkg.environmentVariables) {
            if (envVar.value) {
              // Use the variable name from the value field or description
              const key = envVar.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
              envVars[key] = envVar.default || '';
            }
          }
        }
      }
    }

    return envVars;
  }

  /**
   * Extract all runtime arguments with metadata from server
   */
  private extractArgMetadata(server: RegistryServer): Array<{
    name?: string;
    description?: string;
    default?: string;
    isRequired?: boolean;
    isSecret?: boolean;
    type?: string;
    choices?: string[];
    valueHint?: string;
  }> {
    const args: Array<{
      name?: string;
      description?: string;
      default?: string;
      isRequired?: boolean;
      isSecret?: boolean;
      type?: string;
      choices?: string[];
      valueHint?: string;
    }> = [];
    const seen = new Set<string>();

    if (server.packages && server.packages.length > 0) {
      for (const pkg of server.packages) {
        // Check both packageArguments and runtimeArguments
        const argSources = [...(pkg.packageArguments || []), ...(pkg.runtimeArguments || [])];

        for (const arg of argSources) {
          const name = arg.name;
          if (name && !seen.has(name)) {
            seen.add(name);
            args.push({
              name: arg.name,
              description: arg.description,
              default: arg.default,
              isRequired: arg.isRequired,
              isSecret: arg.isSecret,
              type: arg.type,
              choices: arg.choices,
              valueHint: arg.valueHint,
            });
          }
        }
      }
    }

    return args;
  }

  /**
   * Extract default arguments from server metadata
   */
  private extractDefaultArgs(server: RegistryServer): string[] {
    const args: string[] = [];

    // Check packages for runtime arguments
    if (server.packages && server.packages.length > 0) {
      for (const pkg of server.packages) {
        if (pkg.runtimeArguments && Array.isArray(pkg.runtimeArguments)) {
          for (const arg of pkg.runtimeArguments) {
            if (arg.default) {
              args.push(arg.default);
            }
          }
        }
      }
    }

    return args;
  }

  /**
   * Show confirmation summary
   */
  private async showConfirmation(
    server: RegistryServer,
    config: {
      version?: string;
      localName?: string;
      tags?: string[];
      env?: Record<string, string>;
      args?: string[];
    },
  ): Promise<'back' | boolean> {
    console.clear();
    this.showStepIndicator(4, 5, 'Confirm');

    let content =
      chalk.green.bold('✅ Installation Summary\n\n') +
      chalk.yellow('Server: ') +
      chalk.cyan.bold(server.name) +
      '\n' +
      (config.version ? chalk.yellow('Version: ') + chalk.white(config.version) + '\n' : '') +
      (config.localName ? chalk.yellow('Local Name: ') + chalk.white(config.localName) + '\n' : '') +
      (config.tags && config.tags.length > 0
        ? chalk.yellow('Tags: ') + chalk.white(config.tags.join(', ')) + '\n'
        : '') +
      (config.env && Object.keys(config.env).length > 0
        ? chalk.yellow('Environment: ') + chalk.white(JSON.stringify(config.env, null, 2)) + '\n'
        : '') +
      (config.args && config.args.length > 0
        ? chalk.yellow('Arguments: ') + chalk.white(config.args.join(' ')) + '\n'
        : '');

    console.log(
      boxen(content, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'green',
        title: '📋 Confirm Installation',
        titleAlignment: 'center',
      }),
    );

    console.log(chalk.gray('\nPress ← (left arrow) to go back, → (enter) to proceed, Ctrl+C to cancel\n'));

    // Use toggle to allow left/right arrow navigation
    const result = await prompts({
      type: 'toggle',
      name: 'confirmed',
      message: 'Proceed with installation?',
      initial: true,
      active: 'yes',
      inactive: 'go back',
    });

    // If user cancelled (Ctrl+C)
    if (result.confirmed === undefined) {
      return false;
    }

    // If user selected "go back" (toggled to false)
    if (result.confirmed === false) {
      return 'back';
    }

    return true;
  }

  /**
   * Ask if user wants to install another server
   */
  private async askInstallAnother(): Promise<boolean> {
    const result = await prompts(
      {
        type: 'confirm',
        name: 'another',
        message: 'Install another server?',
        initial: false,
      },
      {
        onCancel: () => {
          return false;
        },
      },
    );

    return Boolean(result.another);
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    // Ensure stdin is properly cleaned up
    const stdin = process.stdin;

    try {
      // Remove all listeners to prevent leaks
      stdin.removeAllListeners('data');
      stdin.removeAllListeners('keypress');
      stdin.removeAllListeners('readable');
      stdin.removeAllListeners('end');

      if (stdin.isTTY && stdin.setRawMode) {
        stdin.setRawMode(false);
      }

      // Pause stdin
      stdin.pause();

      // Destroy any pipes
      if (stdin.unpipe) {
        stdin.unpipe();
      }

      // Unref to allow process to exit even if stdin has pending operations
      if (stdin.unref) {
        stdin.unref();
      }
    } catch {
      // Ignore errors during cleanup - best effort
    }
  }

  /**
   * Get single key input for navigation
   */
  private async getKeyInput(): Promise<string> {
    return new Promise((resolve) => {
      const stdin = process.stdin;

      // Ensure stdin is in the right mode
      if (!stdin.isTTY) {
        resolve('escape');
        return;
      }

      try {
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
      } catch (_error) {
        resolve('escape');
        return;
      }

      const onKeypress = (key: string | Buffer): void => {
        try {
          if (stdin.isTTY) {
            stdin.setRawMode(false);
          }
          stdin.pause();
          stdin.removeListener('data', onKeypress);
        } catch {
          // Ignore cleanup errors
        }

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
        else if (keyStr === '\u001b' || keyStr === '\u0003') {
          // ESC or Ctrl+C - ensure cleanup before resolving
          this.cleanup();
          resolve('escape');
        } else resolve('unknown');
      };

      stdin.on('data', onKeypress);
    });
  }

  /**
   * Create a cancelled result
   */
  private cancelledResult(): WizardInstallConfig {
    return {
      serverId: '',
      cancelled: true,
      installAnother: false,
    };
  }
}
