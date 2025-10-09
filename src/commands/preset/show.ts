import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import { PresetManager } from '@src/utils/config/presetManager.js';
import { InteractiveSelector } from '@src/utils/ui/interactiveSelector.js';
import { UrlGenerator } from '@src/utils/ui/urlGenerator.js';

import boxen from 'boxen';
import chalk from 'chalk';
import type { Argv } from 'yargs';

/**
 * Command arguments for the show command
 */
export interface ShowArguments extends GlobalOptions {
  name: string;
}

/**
 * Build the show command configuration
 */
export function buildShowCommand(yargs: Argv) {
  return yargs.positional('name', {
    describe: 'Name of the preset to show details for',
    type: 'string',
    demandOption: true,
  });
}

/**
 * Show detailed information about a specific preset
 */
export async function showCommand(argv: ShowArguments): Promise<void> {
  try {
    const presetManager = PresetManager.getInstance(argv['config-dir']);
    await presetManager.initialize();
    const selector = new InteractiveSelector();
    const urlGenerator = new UrlGenerator();

    await showPresetDetails(argv.name, presetManager, selector, urlGenerator);
  } catch (error) {
    logger.error('Preset show command failed', { error });
    console.error(`❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * Display detailed preset information
 */
async function showPresetDetails(
  name: string,
  presetManager: PresetManager,
  selector: InteractiveSelector,
  urlGenerator: UrlGenerator,
): Promise<void> {
  if (!presetManager.hasPreset(name)) {
    selector.showError(`Preset '${name}' not found`);
    return;
  }

  const preset = presetManager.getPreset(name);
  if (!preset) {
    selector.showError(`Failed to load preset '${name}'`);
    return;
  }

  // Main preset information in a single comprehensive box
  let mainContent = '';

  // Basic info section
  mainContent += chalk.cyan.bold(`📋 ${preset.name}\n`);
  mainContent += chalk.blue(`Strategy: ${getStrategyDescription(preset.strategy)}\n`);
  if (preset.description) {
    mainContent += chalk.gray(`Description: ${preset.description}\n`);
  }
  mainContent += chalk.dim(`Created: ${new Date(preset.created).toLocaleDateString()}\n`);

  // URL section
  const urlResult = await urlGenerator.validateAndGeneratePresetUrl(name);
  if (urlResult.valid) {
    mainContent += '\n';
    mainContent += chalk.yellow.bold('Client URL:\n');
    mainContent += chalk.cyan(`${urlResult.url}\n`);
  }

  // Query section
  mainContent += '\n';
  mainContent += chalk.yellow.bold('Tag Query:\n');
  const queryStr = JSON.stringify(preset.tagQuery, null, 2);
  mainContent += chalk.green(queryStr);

  // Test results section
  try {
    const testResult = await presetManager.testPreset(name);
    const matchingServers = testResult.servers;

    mainContent += '\n\n';
    mainContent += chalk.yellow.bold(`Matching Servers (${matchingServers.length}):\n`);
    if (matchingServers.length > 0) {
      mainContent += chalk.green(matchingServers.map((server) => `• ${server}`).join(', '));
    } else {
      mainContent += chalk.red('No servers match this preset');
    }

    mainContent += '\n\n';
    mainContent += chalk.yellow.bold('Quick Actions:\n');
    mainContent += chalk.white(`• Test: ${chalk.green(`1mcp preset test ${name}`)}\n`);
    mainContent += chalk.white(`• Edit: ${chalk.green(`1mcp preset select --load ${name}`)}\n`);
    mainContent += chalk.white(`• URL:  ${chalk.green(`1mcp preset url ${name}`)}`);
  } catch (error) {
    mainContent += '\n\n';
    mainContent += chalk.red(`Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  console.log(
    boxen(mainContent, {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'blue',
      title: 'Preset Details',
      titleAlignment: 'center',
    }),
  );
}

/**
 * Get human-readable strategy description
 */
function getStrategyDescription(strategy: string): string {
  switch (strategy) {
    case 'or':
      return 'OR logic - Match ANY selected tags';
    case 'and':
      return 'AND logic - Match ALL selected tags';
    case 'advanced':
      return 'Advanced - Custom JSON query';
    default:
      return strategy;
  }
}
