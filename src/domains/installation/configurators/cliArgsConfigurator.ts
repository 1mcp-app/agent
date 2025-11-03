import chalk from 'chalk';
import prompts from 'prompts';

import type { ArgMetadata } from '../types.js';

/**
 * Configure CLI runtime arguments interactively
 * Prompts user to select which arguments to configure and collects their values
 */
export async function configureCliArgs(argMetadata: ArgMetadata[]): Promise<string[] | null> {
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
