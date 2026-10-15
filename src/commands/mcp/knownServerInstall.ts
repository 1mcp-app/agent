import { knownServerExamples } from '@src/domains/installation/knownServerCatalog.js';
import { createServerInstallationWorkflow } from '@src/domains/installation/serverInstallationWorkflow.js';
import printer from '@src/utils/ui/printer.js';

import prompts from 'prompts';

import type { InstallCommandArgs } from './install.js';
import { installationWorkflowFailureMessage } from './installSource.js';

export async function selectInstallationExample(): Promise<string | undefined> {
  const answer = await prompts({
    type: 'select',
    name: 'example',
    message: 'Choose a maintained example or browse the registry',
    choices: [
      ...knownServerExamples.map((example) => ({
        title: example.label,
        description: example.description,
        value: example.id,
      })),
      { title: 'Browse the registry', value: 'registry' },
    ],
  });
  return typeof answer.example === 'string' ? answer.example : undefined;
}

export async function installKnownServer(argv: InstallCommandArgs): Promise<void> {
  const workflow = createServerInstallationWorkflow();
  const source = {
    type: 'known' as const,
    exampleId: argv.known ?? '',
    localName: argv.name,
    executable: argv.executable,
    checkout: argv.checkout,
  };
  let preview = await workflow.run({ mode: 'preview', force: argv.force, source });
  if (argv.interactive && !argv.dryRun && preview.fieldErrors?.executable) {
    printer.warn(installationWorkflowFailureMessage(preview));
    const answer = await prompts({
      type: 'text',
      name: 'executable',
      message: 'Absolute path to the installed backend executable (cancel to install it first)',
    });
    if (typeof answer.executable !== 'string' || answer.executable.trim() === '') {
      printer.info('Setup cancelled.');
      return;
    }
    source.executable = answer.executable;
    preview = await workflow.run({ mode: 'preview', force: argv.force, source });
  }
  if (preview.status !== 'preview' && preview.status !== 'unchanged') {
    throw new Error(installationWorkflowFailureMessage(preview));
  }

  printer.keyValue({
    Example: source.exampleId,
    Target: preview.targetName ?? source.exampleId,
    Binding: source.checkout
      ? (preview.config?.cwd ?? source.checkout)
      : 'Reusable template: selected authorized checkout',
    Executable: preview.config?.command ?? 'Existing configured executable',
  });
  for (const warning of preview.warnings) printer.warn(warning);
  if (argv.dryRun) {
    printer.info('Dry run: no configuration or backend state changed.');
    return;
  }
  if (preview.status === 'unchanged') {
    printer.success(`Example '${preview.targetName ?? source.exampleId}': Unchanged; no reload requested.`);
    return;
  }
  if (argv.interactive) {
    const answer = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message:
        'Save configuration for this installed backend? A running runtime may reload it; checkout permissions are unchanged.',
      initial: true,
    });
    if (answer.confirmed !== true) {
      printer.info('Setup cancelled.');
      return;
    }
  }
  const result = await workflow.run({
    mode: 'apply',
    force: argv.force,
    source,
    expectedSetupFingerprint: preview.setupFingerprint,
  });
  if (result.status !== 'applied' && result.status !== 'unchanged') {
    throw new Error(installationWorkflowFailureMessage(result));
  }
  printer.success(`Configured example '${result.targetName ?? source.exampleId}'.`);
  if (result.configChange) {
    printer.keyValue({
      Configuration: result.configChange.changed ? 'Updated' : 'Unchanged',
      Reload: result.configChange.reload.status,
    });
    if (result.configChange.backup.path) printer.keyValue({ Backup: result.configChange.backup.path });
  }
  for (const warning of result.warnings) {
    if (!preview.warnings.includes(warning)) printer.warn(warning);
  }
  printer.info('Setup does not certify native freshness or enable automatic preparation.');
}
