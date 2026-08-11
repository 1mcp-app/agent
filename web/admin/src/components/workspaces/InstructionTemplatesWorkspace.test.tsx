import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { vi } from 'vitest';

import type { InstructionTemplatesModel } from '../../instructionTemplates/useInstructionTemplates';
import { InstructionTemplatesWorkspace } from './InstructionTemplatesWorkspace';

function model(overrides: Partial<InstructionTemplatesModel> = {}): InstructionTemplatesModel {
  return {
    items: [
      {
        identity: 'default',
        variants: { initialization: 'built-in init', cli: 'built-in cli' },
        protected: true,
        active: true,
        draft: false,
        validation: { valid: true, initialization: { valid: true }, cli: { valid: true } },
      },
      {
        identity: 'focused',
        variants: { initialization: 'focused init', cli: 'focused cli' },
        protected: false,
        active: false,
        draft: true,
        validation: {
          valid: false,
          initialization: { valid: true },
          cli: { valid: false, error: 'Missing server instructions' },
        },
      },
    ],
    activeIdentity: 'default',
    selectionExplicit: true,
    configFingerprint: 'config_1',
    legacyAvailable: true,
    renderFailures: {},
    selectedIdentity: 'focused',
    draft: { identity: 'focused', variants: { initialization: 'focused init', cli: 'focused cli' } },
    surface: 'cli',
    selection: { mode: 'all' },
    requestContext: '',
    preview: null,
    activationValidation: null,
    previewStale: true,
    dirty: true,
    busy: false,
    error: null,
    select: vi.fn(),
    newDraft: vi.fn(),
    changeIdentity: vi.fn(),
    changeVariant: vi.fn(),
    changeSurface: vi.fn(),
    changeSelection: vi.fn(),
    changeRequestContext: vi.fn(),
    load: vi.fn(async () => undefined),
    saveDraft: vi.fn(async () => true),
    previewDraft: vi.fn(async () => undefined),
    validateDraft: vi.fn(async () => undefined),
    activate: vi.fn(async () => undefined),
    clone: vi.fn(async () => undefined),
    importLegacy: vi.fn(async () => undefined),
    deleteSelected: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('InstructionTemplatesWorkspace', () => {
  it('shows draft validity separately from save and marks stale previews', async () => {
    const instructions = model();
    render(
      <MantineProvider>
        <InstructionTemplatesWorkspace model={instructions} runtimeScopeId="scope_123" />
      </MantineProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Instruction templates' })).toBeInTheDocument();
    expect(screen.getByText('Invalid draft')).toBeInTheDocument();
    expect(screen.getByText('Preview is stale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Activate template' })).toBeDisabled();

    await userEvent.click(screen.getByRole('tab', { name: 'Initialization' }));
    expect(instructions.changeSurface).toHaveBeenCalledWith('initialize');
  });

  it('protects the built-in default from deletion', () => {
    render(
      <MantineProvider>
        <InstructionTemplatesWorkspace
          model={model({ selectedIdentity: 'default', previewStale: false, dirty: false })}
          runtimeScopeId="scope_123"
        />
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: 'Delete template' })).toBeDisabled();
    expect(screen.getByText('Protected built-in')).toBeInTheDocument();
  });
});
