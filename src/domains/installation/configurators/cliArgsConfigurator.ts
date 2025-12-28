import printer from '@src/utils/ui/printer.js';

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
    if (!argsValue) {
      return [];
    }

    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(argsValue) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((a: string) => String(a).trim()).filter((a: string) => a.length > 0);
      }
    } catch {
      // If not valid JSON, treat as comma-separated
    }

    return argsValue
      .split(',')
      .map((a: string) => a.trim())
      .filter((a: string) => a.length > 0);
  }

  // Show summary of available args
  printer.blank();
  printer.title('⚙️  Available Runtime Arguments:');
  printer.raw(`   Found ${argMetadata.length} runtime arguments`);
  printer.blank();

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
    // Use defaults only for required args, otherwise return null
    const defaults = argMetadata.filter((a) => a.isRequired && a.default).map((a) => `${a.name}=${a.default}`);
    return defaults.length > 0 ? defaults : null;
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
  printer.blank();
  printer.title('📝 Configure Selected Arguments:');
  const args: string[] = [];

  for (const name of selectedNames) {
    const arg = argMetadata.find((a) => a.name === name);
    if (!arg || !arg.name) continue;

    let result;
    if (arg.choices && arg.choices.length > 0) {
      result = await prompts({
        type: 'select',
        name: arg.name,
        message: `${arg.name}${arg.isRequired ? chalk.red(' *') : ''}:${arg.description ? `\n   ${chalk.gray(arg.description)}` : ''}`,
        choices: arg.choices.map((c) => ({ title: c, value: c })),
        initial: arg.default ? arg.choices.indexOf(arg.default) : 0,
      });
    } else {
      result = await prompts({
        type: 'text',
        name: arg.name,
        message: `${arg.name}${arg.isRequired ? chalk.red(' *') : ''}:${arg.description ? `\n   ${chalk.gray(arg.description)}` : ''}`,
        initial: arg.default || '',
      });
    }

    const value = String(result[arg.name]).trim();

    // Handle undefined values - if there's a default, use it
    if (result[arg.name] === undefined) {
      if (arg.default) {
        args.push(`${arg.name}=${arg.default}`);
      }
      continue;
    }

    if (value && value !== '') {
      // Format as name=value for CLI args (non-empty values)
      args.push(`${arg.name}=${value}`);
    } else if (arg.isRequired && arg.default) {
      // Required arg with empty value should use default
      printer.warn(`${arg.name} is required, using default value`);
      args.push(`${arg.name}=${arg.default}`);
    } else if (value === '') {
      // Optional arg with empty value should be included as empty string
      args.push(`${arg.name}=${value}`);
    }
  }

  return args;
}
