import chalk from 'chalk';
import prompts from 'prompts';

import type { EnvVarMetadata } from '../types.js';

/**
 * Configure environment variables interactively
 * Prompts user to select which env vars to configure and collects their values
 */
export async function configureEnvVars(envVarMetadata: EnvVarMetadata[]): Promise<Record<string, string> | null> {
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
