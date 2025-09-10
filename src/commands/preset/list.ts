import { PresetManager } from '../../utils/presetManager.js';
import { InteractiveSelector } from '../../utils/interactiveSelector.js';
import logger from '../../logger/logger.js';
import boxen from 'boxen';
import chalk from 'chalk';
import { GlobalOptions } from '@src/globalOptions.js';

/**
 * Command arguments for the list command
 */
interface ListArguments extends GlobalOptions {}

/**
 * List available presets
 */
export async function listCommand(argv?: ListArguments): Promise<void> {
  try {
    const presetManager = PresetManager.getInstance(argv?.['config-dir']);
    await presetManager.initialize();
    const selector = new InteractiveSelector();
    await listPresets(presetManager, selector);
  } catch (error) {
    logger.error('Preset list command failed', { error });
    console.error(`❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * List available presets using TUI styling
 */
async function listPresets(presetManager: PresetManager, _selector: InteractiveSelector): Promise<void> {
  const presets = presetManager.getPresetList();

  if (presets.length === 0) {
    console.log(
      boxen(chalk.red.bold('⚠️  No presets found'), {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'red',
        title: 'No Presets Available',
        titleAlignment: 'center',
      }),
    );
    console.log(chalk.yellow('\nCreate your first preset with:'));
    console.log(chalk.cyan('  1mcp preset create <name> --filter "web,api,database"'));
    console.log(chalk.cyan('  1mcp preset select --save <name> --url'));
    return;
  }

  // Header
  const headerMessage = boxen(
    chalk.cyan.bold('📋 Available Presets\n\n') +
      chalk.yellow(`Found ${presets.length} preset${presets.length === 1 ? '' : 's'} in your configuration`),
    {
      padding: 1,
      margin: 1,
      borderStyle: 'double',
      borderColor: 'cyan',
      title: 'Preset Manager',
      titleAlignment: 'center',
    },
  );
  console.log(headerMessage);

  // Create clean table layout
  let tableContent = '';

  // Table header
  tableContent += chalk.cyan.bold('  Name              Strategy   Query                               Last Used\n');
  tableContent += chalk.gray('  ────────────────  ─────────  ──────────────────────────────────  ─────────\n');

  // Table rows
  for (const preset of presets) {
    const lastUsed = preset.lastUsed ? new Date(preset.lastUsed).toLocaleDateString() : 'never';
    const strategyDesc = getStrategyDescription(preset.strategy);
    const queryStr = JSON.stringify(preset.tagQuery) || '{}';

    // Format fields with proper truncation
    const name = preset.name.length > 16 ? preset.name.slice(0, 13) + '...' : preset.name;
    const strategy = strategyDesc.length > 9 ? strategyDesc.slice(0, 9) : strategyDesc;
    const query = queryStr.length > 33 ? queryStr.slice(0, 30) + '...' : queryStr;
    const lastUsedStr = lastUsed.length > 9 ? lastUsed.slice(0, 9) : lastUsed;

    tableContent +=
      `  ${chalk.yellow(name.padEnd(16))}  ` +
      `${chalk.blue(strategy.padEnd(9))}  ` +
      `${chalk.green(query.padEnd(33))}  ` +
      `${chalk.gray(lastUsedStr)}\n`;
  }

  const tableBox = boxen(tableContent.trim(), {
    padding: 1,
    borderStyle: 'round',
    borderColor: 'blue',
    title: 'Preset Overview',
    titleAlignment: 'center',
  });

  console.log(tableBox);

  // Commands help section
  const commandsContent =
    chalk.cyan.bold('Available Commands:\n\n') +
    chalk.white('• ') +
    chalk.green('1mcp preset show <name>') +
    chalk.gray('          Show full preset details\n') +
    chalk.white('• ') +
    chalk.green('1mcp preset url <name>') +
    chalk.gray('           Generate URL\n') +
    chalk.white('• ') +
    chalk.green('1mcp preset select --load <name>') +
    chalk.gray('  Edit preset\n') +
    chalk.white('• ') +
    chalk.green('1mcp preset test <name>') +
    chalk.gray('          Test preset\n') +
    chalk.white('• ') +
    chalk.green('1mcp preset delete <name>') +
    chalk.gray('        Delete preset');

  console.log('');
  console.log(
    boxen(commandsContent, {
      padding: 1,
      borderStyle: 'single',
      borderColor: 'gray',
      title: 'Quick Reference',
      titleAlignment: 'center',
    }),
  );
  console.log('');
}

/**
 * Get human-readable strategy description
 */
function getStrategyDescription(strategy: string): string {
  switch (strategy) {
    case 'or':
      return 'OR logic';
    case 'and':
      return 'AND logic';
    case 'advanced':
      return 'Advanced';
    default:
      return strategy;
  }
}
