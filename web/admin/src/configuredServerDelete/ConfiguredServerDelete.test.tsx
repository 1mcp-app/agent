import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import { describe, expect, it, vi } from 'vitest';

import { ConfiguredServerDelete } from './ConfiguredServerDelete';
import type { ConfiguredServerDeleteModel } from './useConfiguredServerDelete';

describe('ConfiguredServerDelete', () => {
  it('shows runtime impact and enables deletion only for the exact qualified identity', () => {
    const changeConfirmation = vi.fn();
    const apply = vi.fn();
    const model: ConfiguredServerDeleteModel = {
      state: {
        previewBusy: false,
        applyBusy: false,
        error: null,
        result: null,
        confirmation: '',
        preview: {
          target: { type: 'configured_server', source: 'mcpTemplates', id: 'shared' },
          qualifiedId: 'mcpTemplates/shared',
          targetFingerprint: 'target-fingerprint',
          previewFingerprint: 'delete-preview',
          authority: 'authoritative',
          removal: {
            definition: {
              id: 'shared',
              source: 'mcpTemplates',
              target: { type: 'configured_server', source: 'mcpTemplates', id: 'shared' },
              enabled: true,
              tags: [],
              transportSummary: { kind: 'stdio', label: 'STDIO' },
              mutationAvailability: { available: false, operations: [], deleteAvailable: true },
              actionState: {
                enable: { available: false, label: 'Enable' },
                disable: { available: false, label: 'Disable' },
              },
              transport: { type: 'stdio', command: '{{project.command}}' },
              secretInputs: [],
            },
            preservesSameNamedOtherSource: true,
            cascades: false,
          },
          configChange: {} as never,
          expectedBackup: { policy: 'required', recoveryCopy: true },
          expectedReload: {
            policy: 'observe_after_write',
            possibleStatuses: ['observed', 'runtime_not_running', 'reload_disabled', 'failed'],
          },
          runtimeImpact: { kind: 'template', activeInstanceCount: 2, retirement: 'reload_scheduled' },
          warnings: ['The other source is preserved.'],
        },
      },
      preview: vi.fn(),
      changeConfirmation,
      apply,
      reset: vi.fn(),
    };
    const target = { type: 'configured_server' as const, source: 'mcpTemplates' as const, id: 'shared' };

    const { rerender } = render(
      <MantineProvider>
        <ConfiguredServerDelete model={model} target={target} />
      </MantineProvider>,
    );
    expect(screen.getByText(/2 active instances will be retired/u)).toBeInTheDocument();
    expect(screen.getByText('Identity: mcpTemplates/shared')).toBeInTheDocument();
    expect(screen.getByText('Authority: authoritative')).toBeInTheDocument();
    expect(screen.getByText('Target fingerprint: target-fingerprint')).toBeInTheDocument();
    expect(screen.getByText('Removal diff: present definition to removed')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_content, element) => element?.tagName === 'PRE' && element.textContent?.includes('"source": "mcpTemplates"'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete definition' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type mcpTemplates/shared to confirm'), {
      target: { value: 'mcpTemplates/shared' },
    });
    expect(changeConfirmation).toHaveBeenCalledWith('mcpTemplates/shared');

    model.state.confirmation = 'mcpTemplates/shared';
    rerender(
      <MantineProvider>
        <ConfiguredServerDelete model={model} target={target} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete definition' }));
    expect(apply).toHaveBeenCalledWith(target);
  });

  it('shows post-write reload recovery without exposing the raw error or backup path', () => {
    const model = {
      state: {
        preview: null,
        confirmation: '',
        previewBusy: false,
        applyBusy: false,
        error: null,
        result: {
          target: { type: 'configured_server' as const, source: 'mcpTemplates' as const, id: 'shared' },
          qualifiedId: 'mcpTemplates/shared',
          previewFingerprint: 'delete-preview',
          configChange: {
            status: 'changed',
            operation: 'remove',
            target: { name: 'shared', source: 'mcpTemplates' },
            changed: true,
            backup: { created: true, path: '/secret/config.backup' },
            retentionCleanup: { attempted: true, deletedPaths: [], warnings: [] },
            reload: { status: 'failed', error: 'secret internal reload detail' },
          },
        },
      },
      preview: vi.fn(),
      changeConfirmation: vi.fn(),
      apply: vi.fn(),
      reset: vi.fn(),
    } satisfies ConfiguredServerDeleteModel;

    render(
      <MantineProvider>
        <ConfiguredServerDelete model={model} target={model.state.result.target} />
      </MantineProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/deleted from disk.*runtime reload failed.*may still serve/u);
    expect(screen.getByRole('status')).toHaveTextContent('A recovery backup exists.');
    expect(screen.queryByText(/secret internal|\/secret\/config/u)).not.toBeInTheDocument();
  });
});
