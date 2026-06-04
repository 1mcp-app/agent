import prompts from 'prompts';

export interface ConfirmSaveResult {
  name: string;
  description?: string;
  save: boolean;
}

export async function confirmPresetSave(presetName?: string): Promise<ConfirmSaveResult> {
  if (presetName) {
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

  const nameInput = await prompts({
    type: 'text',
    name: 'name',
    message: 'Enter preset name:',
    validate: validatePresetNameInput,
  });

  if (!nameInput.name || nameInput.name === null || nameInput.name === '') {
    return { name: '', save: false };
  }

  const descriptionInput = await prompts({
    type: 'text',
    name: 'description',
    message: 'Enter optional description:',
  });

  if (!nameInput.name || typeof nameInput.name !== 'string') {
    return { name: '', save: false };
  }

  return {
    name: nameInput.name.trim(),
    description: trimOptionalDescription(descriptionInput.description),
    save: true,
  };
}

function validatePresetNameInput(value: string): boolean | string {
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
}

function trimOptionalDescription(description: unknown): string | undefined {
  if (!description || typeof description !== 'string') {
    return undefined;
  }

  const trimmed = description.trim();
  return trimmed === '' ? undefined : trimmed;
}
