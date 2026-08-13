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
    reloadWarning: null,
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

  it('shows unresolved contextual servers and effective instruction facts', () => {
    render(
      <MantineProvider>
        <InstructionTemplatesWorkspace
          model={model({
            dirty: false,
            previewStale: false,
            preview: {
              surface: 'cli',
              rendered: 'rendered output',
              unresolvedTemplates: ['github-context', 'linear-context'],
              effectiveServers: [
                { target: { source: 'mcpServers', name: 'filesystem' }, hasInstructions: true },
                { target: { source: 'mcpTemplates', name: 'github-context' }, hasInstructions: false },
              ],
            },
          })}
        />
      </MantineProvider>,
    );

    expect(screen.getByText('Unresolved Template Servers: github-context, linear-context')).toBeInTheDocument();
    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByLabelText('Effective servers')).toHaveTextContent('github-context');
    expect(screen.getByText('Instructions')).toBeInTheDocument();
    expect(screen.getByText('No instructions')).toBeInTheDocument();
  });

  it('builds a complete explicit request context and surfaces reload warnings', async () => {
    const instructions = model({
      dirty: false,
      reloadWarning: 'Configuration was written, but runtime reload failed: reload timed out',
    });
    render(
      <MantineProvider>
        <InstructionTemplatesWorkspace model={instructions} />
      </MantineProvider>,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Use explicit request context' }));
    expect(instructions.changeRequestContext).toHaveBeenLastCalledWith(
      JSON.stringify({ project: {}, user: {}, environment: {} }),
    );
    expect(screen.getByText(/runtime reload failed: reload timed out/i)).toBeInTheDocument();
  });
});
